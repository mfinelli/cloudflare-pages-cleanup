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

import "cloudflare/shims/web";
import Cloudflare from "cloudflare";
import { Deployment, Environment } from "./types";

// --- helpers (top of file or near the function) ---
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function getStr(o: Record<string, unknown>, k: string): string | undefined {
  return typeof o[k] === "string" ? (o[k] as string) : undefined;
}
function getStrArray(
  o: Record<string, unknown>,
  k: string,
): string[] | undefined {
  const v = o[k];
  return Array.isArray(v) && v.every((x) => typeof x === "string")
    ? (v as string[])
    : undefined;
}
function getEnv(
  o: Record<string, unknown>,
  k: string,
): "production" | "preview" | undefined {
  const v = o[k];
  return v === "production" || v === "preview" ? v : undefined;
}
function readBranch(o: Record<string, unknown>): string | undefined {
  // o is expected to be d.deployment_trigger
  const meta = isRecord(o.metadata)
    ? (o.metadata as Record<string, unknown>)
    : undefined;
  return meta ? getStr(meta, "branch") : undefined;
}
function readLatestStageStatus(o: Record<string, unknown>): string | undefined {
  return getStr(o, "status");
}
function readSourceConfigProdBranch(
  o: Record<string, unknown>,
): string | undefined {
  const cfg = isRecord(o.config)
    ? (o.config as Record<string, unknown>)
    : undefined;
  return cfg ? getStr(cfg, "production_branch") : undefined;
}
// --- end helpers ---

// Singleton client (build once)
let cf: Cloudflare | null = null;
function getClient(apiToken: string): Cloudflare {
  if (!cf) {
    cf = new Cloudflare({
      apiToken,
      // SDK already retries a bit; you can tune if desired:
      maxRetries: 2,
      timeout: 60_000,
    });
  }
  return cf;
}

/**
 * List deployments for a project, optionally filtered by environment.
 * Uses the official Cloudflare TS SDK.
 */
export async function listDeployments(params: {
  accountId: string;
  apiToken: string;
  project: string;
  env?: Environment;
}): Promise<Deployment[]> {
  const { accountId, apiToken, project, env } = params;
  const client = getClient(apiToken);

  const result: Deployment[] = [];
  // The SDK's list() is AsyncIterable; iterate all pages
  for await (const d of client.pages.projects.deployments.list(project, {
    account_id: accountId,
    env,
  })) {
    // Start from unknown and narrow
    const rec = d as unknown as Record<string, unknown>;

    const id = getStr(rec, "id");
    const created_on = getStr(rec, "created_on");
    const environment = getEnv(rec, "environment");
    if (!id || !created_on || !environment) {
      // If the SDK changes shape unexpectedly, fail fast with a clear error
      throw new Error(
        "Cloudflare deployment object missing id/created_on/environment",
      );
    }

    const short_id = getStr(rec, "short_id");
    const url = getStr(rec, "url");
    const aliases = getStrArray(rec, "aliases");

    // Optional nested objects (safely narrowed)
    const deployment_trigger = isRecord(rec["deployment_trigger"])
      ? {
          metadata: {
            branch: readBranch(
              rec["deployment_trigger"] as Record<string, unknown>,
            ),
            // commit_hash/commit_message are optional; add if you need them:
            // commit_hash: ...
            // commit_message: ...
          },
        }
      : undefined;

    const latest_stage = isRecord(rec["latest_stage"])
      ? {
          status: readLatestStageStatus(
            rec["latest_stage"] as Record<string, unknown>,
          ),
        }
      : undefined;

    const source = isRecord(rec["source"])
      ? {
          config: isRecord((rec["source"] as Record<string, unknown>)["config"])
            ? {
                production_branch: readSourceConfigProdBranch(
                  (rec["source"] as Record<string, unknown>)[
                    "config"
                  ] as Record<string, unknown>,
                ),
              }
            : undefined,
        }
      : undefined;

    result.push({
      id,
      short_id,
      created_on,
      environment,
      url,
      aliases,
      deployment_trigger,
      latest_stage,
      source,
    });
  }
  return result;
}

/**
 * Delete a deployment by ID via SDK.
 */
export async function deleteDeployment(params: {
  accountId: string;
  apiToken: string;
  project: string;
  deploymentId: string;
}): Promise<void> {
  const { accountId, apiToken, project, deploymentId } = params;
  const client = getClient(apiToken);
  await client.pages.projects.deployments.delete(project, deploymentId, {
    account_id: accountId,
  });
}

/**
 * Heuristic: the newest production deployment is treated as "active".
 * (Good enough for v1; you could switch to Get Project -> canonical_deployment later.)
 */
export function detectActiveProduction(
  deployments: Deployment[],
): string | undefined {
  const prod = deployments.filter((d) => d.environment === "production");
  prod.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  return prod[0]?.id;
}

/** Returns true if deployment has any aliases (thus protected). */
export function hasAliases(d: Deployment): boolean {
  return Array.isArray(d.aliases) && d.aliases.length > 0;
}
