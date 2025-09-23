/**
 * Copyright 2025 Mario Finelli
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Deployment, Environment, SelectionBucket } from "./types";

/**
 * Selects deployments to **keep** or **delete** for a single environment.
 *
 * Pipeline (in order):
 *  1) Filters `deployments` to the given `env` and sorts by `created_on` (newest → oldest).
 *  2) **Protections**:
 *     - If `env === "production"` and `activeProdId` is provided, that ID is always kept and
 *       recorded in `skippedProtectedIds`.
 *     - Any deployment with one or more `aliases` is always kept and recorded in
 *       `skippedProtectedIds`.
 *  3) **Retention window**:
 *     - Computes `keepCut = max(minToKeep, maxToKeep)`.
 *     - The newest `keepCut` items are **kept** unconditionally (this implicitly satisfies the
 *       `minToKeep` floor and `maxToKeep` cap).
 *  4) **Candidates** are items **beyond** the `keepCut` that are not protected:
 *     - If `olderThanMs` is provided, only candidates **older than** that timestamp are eligible
 *       for deletion. Newer-than-threshold candidates are **kept**.
 *     - In the **preview** environment, the **newest deployment per branch** is considered
 *       *undeletable* (per Cloudflare rules) and is **kept** and recorded in
 *       `skippedUndeletableIds`.
 *  5) All remaining eligible candidates are marked for **deletion**.
 *
 * Returns a `SelectionBucket` (IDs to keep/delete/skip) and `consideredCount`, which is the number
 * of non-protected items examined **beyond** the retention window (i.e., candidates), regardless of
 * whether they were later kept due to age threshold or preview branch-undeletable rules.
 *
 * Notes:
 * - This function is **pure**; it does not mutate its inputs.
 * - `created_on` is interpreted as an ISO-8601 timestamp (UTC). Age comparisons are numeric
 *   epoch-ms comparisons against `olderThanMs`.
 * - If branch metadata is missing on a preview deployment, it is treated as a normal candidate
 *   (i.e., not marked undeletable).
 * - The sort is newest → oldest; ties follow the engine’s stable sort (typical in modern Node).
 * - The returned ID sets are disjoint by construction.
 *
 * @param params.env - Target environment: `"production"` or `"preview"`.
 * @param params.deployments - Mixed/unsorted list; only the target env is considered.
 * @param params.activeProdId - When provided and `env === "production"`, this ID is always kept.
 * @param params.minToKeep - Floor of newest items to keep (per env).
 * @param params.maxToKeep - Cap of newest items to keep (per env); `keepCut = max(min,max)`.
 * @param params.olderThanMs - Optional cutoff timestamp; only older candidates may be deleted.
 *
 * @returns An object with:
 *  - `bucket.keptIds`: kept this run (includes protected, within-retention, and below age threshold)
 *  - `bucket.deletedIds`: selected for deletion
 *  - `bucket.skippedProtectedIds`: protected by policy (active prod, aliases)
 *  - `bucket.skippedUndeletableIds`: preview newest-per-branch
 *  - `consideredCount`: number of non-protected candidates beyond `keepCut`
 */
export function selectForEnvironment(params: {
  env: Environment;
  deployments: Deployment[];
  activeProdId?: string;
  minToKeep: number;
  maxToKeep: number;
  olderThanMs?: number;
}): { bucket: SelectionBucket; consideredCount: number } {
  const { env, deployments, activeProdId, minToKeep, maxToKeep, olderThanMs } =
    params;

  const filtered = deployments.filter((d) => d.environment === env);
  // newest -> oldest
  filtered.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));

  const bucket: SelectionBucket = {
    keptIds: [],
    deletedIds: [],
    skippedProtectedIds: [],
    skippedUndeletableIds: [],
  };

  // Mark protections
  const isProtected = (d: Deployment): boolean => {
    if (env === "production" && activeProdId && d.id === activeProdId)
      return true; // active prod
    if (Array.isArray(d.aliases) && d.aliases.length > 0) return true; // alias protection
    return false;
  };

  // Keep newest maxToKeep (implicitly >= minToKeep)
  const keepCut = Math.max(maxToKeep, minToKeep);

  // Anything up to keepCut is auto-kept (plus any protected outside that window)
  const autoKeepSet = new Set(filtered.slice(0, keepCut).map((d) => d.id));

  let considered = 0;

  for (let i = 0; i < filtered.length; i++) {
    const d = filtered[i];
    const createdMs = Date.parse(d.created_on);

    if (isProtected(d)) {
      bucket.skippedProtectedIds.push(d.id);
      bucket.keptIds.push(d.id);
      continue;
    }

    if (autoKeepSet.has(d.id)) {
      bucket.keptIds.push(d.id);
      continue;
    }

    // Now beyond keepCut -> candidate
    considered++;

    // Age threshold
    if (olderThanMs !== undefined && createdMs > olderThanMs) {
      bucket.keptIds.push(d.id);
      continue;
    }

    // Potential "latest per branch" undeletable constraint:
    // If it's the newest deployment *for its branch* in preview env, mark undeletable and keep.
    if (env === "preview") {
      const branch = d.deployment_trigger?.metadata?.branch;
      if (branch) {
        const newestForBranch = filtered.find(
          (x) => x.deployment_trigger?.metadata?.branch === branch,
        );
        if (newestForBranch?.id === d.id) {
          bucket.skippedUndeletableIds.push(d.id);
          bucket.keptIds.push(d.id);
          continue;
        }
      }
    }

    bucket.deletedIds.push(d.id);
  }

  return { bucket, consideredCount: considered };
}
