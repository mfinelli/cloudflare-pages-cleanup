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
    // Map to our local Deployment shape (fields align closely)
    result.push({
      id: (d as any).id,
      short_id: (d as any).short_id,
      created_on: (d as any).created_on,
      environment: (d as any).environment,
      url: (d as any).url,
      aliases: (d as any).aliases,
      deployment_trigger: (d as any).deployment_trigger,
      latest_stage: (d as any).latest_stage,
      source: (d as any).source,
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
