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
 * Returns selection for a single environment (production or preview).
 * - Protects active production deployment (if env === 'production' and activeProdId provided)
 * - Protects any deployment with aliases
 * - Keeps newest minToKeep and up to maxToKeep (cap)
 * - Deletes only beyond maxToKeep and (if provided) older than threshold
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
