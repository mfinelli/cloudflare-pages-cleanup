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
import * as core from "@actions/core";
import { Deployment, Environment } from "./types";
import { errorMessage } from "./utils";

/**
 * @internal
 * Type guard that narrows a value to a plain object-like record
 * (`Record<string, unknown>`).
 *
 * Semantics:
 * - Returns `true` for non-null objects whose internal tag is
 *   `"[object Object]"` (e.g., `{}`, objects created via `Object.create(null)`,
 *   and class instances).
 * - Returns `false` for `null`, arrays, functions, dates, regexps, numbers,
 *   strings, booleans, etc.
 *
 * Notes:
 * - This **does not** validate any specific shape - it only tells you the value
 *   is object-like and key-addressable. You should still check the presence and
 *   types of expected properties.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return Object.prototype.toString.call(v) === "[object Object]";
}

/**
 * @internal
 * Safely reads a string property from a generic record.
 *
 * Returns the value only if `o[k]` exists and has type `string`; otherwise
 * returns `undefined`. No trimming or coercion is performed.
 *
 * @param o - A generic object-like map (`Record<string, unknown>`).
 * @param k - The property key to read.
 * @returns The string value, or `undefined` if missing or not a string.
 *
 * @example
 * const rec: Record<string, unknown> = { id: "abc", n: 42 };
 * getStr(rec, "id"); // "abc"
 * getStr(rec, "n");  // undefined
 * getStr(rec, "x");  // undefined
 */
export function getStr(
  o: Record<string, unknown>,
  k: string,
): string | undefined {
  return typeof o[k] === "string" ? (o[k] as string) : undefined;
}

/**
 * @internal
 * Safely reads an array-of-strings property from a generic record.
 *
 * Returns the value only if `o[k]` is an `Array` and **every element** is a
 * primitive string. No coercion, trimming, or cloning is performed; the
 * original array reference is returned (including `[]`).
 *
 * @param o - A generic object-like map (`Record<string, unknown>`).
 * @param k - The property key to read.
 * @returns The string[] value, or `undefined` if missing or not an array of strings.
 *
 * @example
 * const rec: Record<string, unknown> = { aliases: ["a.example.com", "b.example.com"] };
 * getStrArray(rec, "aliases"); // ["a.example.com", "b.example.com"]
 * getStrArray(rec, "missing"); // undefined
 * getStrArray({ aliases: ["ok", "not ok", 123] } as any, "aliases"); // undefined
 */
export function getStrArray(
  o: Record<string, unknown>,
  k: string,
): string[] | undefined {
  const v = o[k];
  return Array.isArray(v) && v.every((x) => typeof x === "string")
    ? (v as string[])
    : undefined;
}

/**
 * @internal
 * Reads an environment value from a generic record and narrows it to the
 * literal union `"production" | "preview"`.
 *
 * Strict semantics:
 * - Returns the value only if `o[k]` is exactly the primitive string
 *   `"production"` or `"preview"`.
 * - No trimming, case-folding, or coercion is performed.
 *   (e.g., `"Production"`, `" PREVIEW "`, or `new String("production")`
 *   are rejected and yield `undefined`.)
 *
 * @param o - Object-like map (`Record<string, unknown>`).
 * @param k - Property key to read.
 * @returns `"production"`, `"preview"`, or `undefined` if missing/mismatched.
 *
 * @example
 * getEnv({ environment: "production" }, "environment"); // "production"
 * getEnv({ environment: "PREVIEW" }, "environment");    // undefined
 */
export function getEnv(
  o: Record<string, unknown>,
  k: string,
): "production" | "preview" | undefined {
  const v = o[k];
  return v === "production" || v === "preview" ? v : undefined;
}

/**
 * @internal
 * Reads `deployment_trigger.metadata.branch` from a generic record.
 *
 * Semantics:
 * - Expects `o` to be the **deployment_trigger** object from a Cloudflare
 *   deployment. If `o.metadata` is a plain object and `metadata.branch` is a
 *   **primitive string**, returns that value.
 * - Returns `undefined` when `metadata` is missing/non-object or when
 *   `branch` is missing or not a primitive string.
 * - No trimming or coercion is performed; wrapper strings (e.g., `Object("x")`)
 *   are rejected.
 *
 * @param o - The deployment_trigger object as a generic record.
 * @returns The branch name string or `undefined`.
 *
 * @example
 * readBranch({ metadata: { branch: "feature/login" } }) // "feature/login"
 * readBranch({ metadata: {} })                          // undefined
 * readBranch({})                                        // undefined
 */
export function readBranch(o: Record<string, unknown>): string | undefined {
  const m = (o as Record<string, unknown>)["metadata"];
  const meta = isRecord(m) ? (m as Record<string, unknown>) : undefined;
  return meta ? getStr(meta, "branch") : undefined;
}

/**
 * @internal
 * Reads `latest_stage.status` from a generic record.
 *
 * Semantics:
 * - Returns the value only if `o.status` is a **primitive string**.
 * - No trimming, case-folding, or coercion is performed.
 * - Typical values from Cloudflare include: "success", "failure", "queued",
 *   "building", etc., but this helper does not validate the enum.
 *
 * @param o - The `latest_stage` object as a generic record.
 * @returns The status string, or `undefined` if missing or not a primitive string.
 *
 * @example
 * readLatestStageStatus({ status: "success" }) // "success"
 * readLatestStageStatus({})                    // undefined
 */
export function readLatestStageStatus(
  o: Record<string, unknown>,
): string | undefined {
  return getStr(o, "status");
}

/**
 * @internal
 * Reads the `production_branch` string from either:
 *  - a Cloudflare deployment `source.config` object, or
 *  - a `source` object that contains a `config` object.
 *
 * Semantics:
 * - Returns the value only if `production_branch` is a **primitive string**.
 * - No trimming, coercion, or case-folding.
 * - Wrapper strings (e.g., `Object("main")`) are rejected.
 *
 * @param o - Either the `source.config` object or the `source` object.
 * @returns The production branch (e.g., `"main"`), or `undefined` if missing/not a string.
 *
 * @example
 * readSourceConfigProdBranch({ production_branch: "main" })                 // from config
 * readSourceConfigProdBranch({ config: { production_branch: "main" } })    // from source
 */
export function readSourceConfigProdBranch(
  o: Record<string, unknown>,
): string | undefined {
  // Case 1: called with the config object directly
  const direct = getStr(o, "production_branch");
  if (direct !== undefined) return direct;

  // Case 2: called with the source object containing config
  const cfg = isRecord(o["config"])
    ? (o["config"] as Record<string, unknown>)
    : undefined;
  return cfg ? getStr(cfg, "production_branch") : undefined;
}

/**
 * Singleton client object (define before below function)
 */
let cf: Cloudflare | null = null;

/**
 * Returns a **process-wide singleton** instance of the Cloudflare TS SDK client.
 *
 * Behavior:
 * - Lazily constructs the client on first call using the provided `apiToken`.
 * - Subsequent calls return the same instance and **ignore different tokens**.
 * - Uses Node 20’s built-in `fetch` via `cloudflare/shims/web`.
 * - Sets conservative defaults (`maxRetries`, `timeout`)
 *
 * Notes:
 * - Intended for a single account/token per action run. If you need multiple
 *   accounts or token rotation in one process, **do not use this singleton**;
 *   instead create dedicated `new Cloudflare({ apiToken })` instances.
 * - The Cloudflare SDK already retries some 429/5xx responses; adjust
 *   `maxRetries` here if you want a different policy.
 * - This function does not log or expose the token.
 *
 * @param apiToken - Cloudflare API token with Pages read+edit permissions.
 * @returns A `Cloudflare` client ready for API calls.
 *
 * @example
 * const cf = getClient(inputs.apiToken);
 * for await (const d of cf.pages.projects.deployments.list(inputs.project, {
 *   account_id: inputs.accountId,
 * })) {
 *   // ...
 * }
 */
function getClient(apiToken: string): Cloudflare {
  if (!cf) {
    cf = new Cloudflare({
      apiToken,
      maxRetries: 2,
      timeout: 60_000,
    });
  }
  return cf;
}

/**
 * Lists Cloudflare Pages deployments for a single project, optionally filtered
 * by environment, and maps each item to our local {@link Deployment} shape.
 *
 * Behavior:
 * - Uses the Cloudflare TypeScript SDK’s async iterator to pull **all pages**
 *   of results and aggregates them into an array.
 * - If `env` is provided (`"production"` or `"preview"`), the SDK performs a
 *   server-side filter; otherwise all environments are returned.
 * - Each SDK item is **narrowed** (via internal guards) to extract only the
 *   fields we use (`id`, `created_on`, `environment`, `aliases`, etc.).
 *   If any item is missing **required** fields (`id`, `created_on`, `environment`),
 *   an error is thrown to fail fast.
 * - The returned array preserves the SDK’s iteration order (typically newest → oldest,
 *   but not guaranteed). Callers should sort as needed.
 *
 * Notes:
 * - Relies on a singleton Cloudflare client from {@link getClient}, which uses
 *   Node 20’s built-in `fetch` (via `cloudflare/shims/web`) and the SDK’s
 *   built-in retry policy for certain 429/5xx responses.
 * - This function does **not** perform any deletion or selection logic; it is a
 *   read-only fetch used by higher-level orchestration.
 * - Alias presence (`aliases.length > 0`) is preserved so callers can treat those
 *   deployments as protected.
 *
 * @param params.accountId - Cloudflare account ID.
 * @param params.apiToken  - API token with Pages read+edit permissions.
 * @param params.project   - Cloudflare Pages project name.
 * @param params.env       - Optional environment filter (`"production"` or `"preview"`).
 *
 * @returns Promise that resolves to an array of {@link Deployment} objects.
 *
 * @throws {Error} If the SDK call fails, or if an item cannot be narrowed to
 *   the required deployment fields.
 *
 * @example
 * // Fetch all deployments (both environments)
 * const all = await listDeployments({
 *   accountId: inputs.accountId,
 *   apiToken: inputs.apiToken,
 *   project: inputs.project
 * });
 *
 * // Fetch only preview deployments
 * const previews = await listDeployments({
 *   accountId: inputs.accountId,
 *   apiToken: inputs.apiToken,
 *   project: inputs.project,
 *   env: "preview"
 * });
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
 * Deletes a single Cloudflare Pages deployment by ID using the Cloudflare
 * TypeScript SDK.
 *
 * Behavior:
 * - Thin wrapper over
 *   `cf.pages.projects.deployments.delete(project, deploymentId, { account_id })`.
 * - Performs no additional retries beyond the SDK’s built-in policy; any SDK
 *   error is allowed to propagate to the caller.
 * - Irreversible side effect: the deployment is permanently removed by
 *   Cloudflare if the request succeeds.
 *
 * Notes:
 * - Cloudflare may reject certain deletions (e.g., the **latest preview**
 *   deployment for a branch, insufficient permissions, or alias constraints).
 *   In those cases the SDK throws (e.g., 403/409), and the caller decides
 *   whether to fail the job (see `failOnError` handling in the main flow).
 * - A non-existent or already-deleted ID typically results in a 404 from the
 *   API, which the SDK surfaces as an error; this function does not treat that
 *   as success.
 * - Use dry-run mode upstream to preview which IDs would be deleted before
 *   invoking this function.
 *
 * @param params.accountId - Cloudflare account ID.
 * @param params.apiToken  - API token with Pages read+edit permissions.
 * @param params.project   - Cloudflare Pages project name.
 * @param params.deploymentId - The deployment ID to delete.
 *
 * @returns A promise that resolves when the delete request completes successfully.
 *
 * @throws {Error} If the SDK request fails (network error, 4xx/5xx response,
 *   permission issues, undeletable latest-per-branch, etc.).
 *
 * @example
 * await deleteDeployment({
 *   accountId: inputs.accountId,
 *   apiToken: inputs.apiToken,
 *   project: inputs.project,
 *   deploymentId: "abc123"
 * });
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
 * Returns the ID of the deployment currently serving the project's
 * **production** traffic, using the Cloudflare Projects API:
 * `project.canonical_deployment.id`.
 *
 * Behavior:
 * - Performs a single SDK call:
 *   `cf.pages.projects.get(project, { account_id })`
 * - Extracts `canonical_deployment.id` if present and a primitive string.
 * - Returns `undefined` if the field is absent or the call fails.
 *
 * Notes:
 * - This is the safest way to identify the active prod deployment (resilient
 *   to failed latest builds, manual rollbacks, and timestamp quirks).
 * - Callers should **fallback** to a heuristic if this returns `undefined`.
 *
 * @param params.accountId - Cloudflare account ID.
 * @param params.apiToken  - API token with Pages read+edit.
 * @param params.project   - Cloudflare Pages project name.
 * @returns The active prod deployment ID, or `undefined` if unknown/unavailable.
 */
export async function getCanonicalProductionDeploymentId(params: {
  accountId: string;
  apiToken: string;
  project: string;
}): Promise<string | undefined> {
  const { accountId, apiToken, project } = params;
  const client = getClient(apiToken);

  try {
    const proj = await client.pages.projects.get(project, {
      account_id: accountId,
    });
    const rec = proj as unknown as Record<string, unknown>;
    const cd = isRecord(rec["canonical_deployment"])
      ? (rec["canonical_deployment"] as Record<string, unknown>)
      : undefined;
    const id = cd ? getStr(cd, "id") : undefined;
    return id;
  } catch (e) {
    // Non-fatal: let caller decide how to handle fallback.
    core.info(
      `getCanonicalProductionDeploymentId: falling back (reason: ${errorMessage(e)})`,
    );
    return undefined;
  }
}

/**
 * Heuristic fallback to identify the *active* production deployment ID
 * from an in-memory list of deployments.
 *
 * Behavior:
 *  1) Filters `deployments` to `environment === "production"`.
 *  2) Sorts by `created_on` (newest → oldest).
 *  3) Prefers the **newest with `latest_stage.status === "success"`**.
 *     If none are successful, returns the **absolute newest** production ID.
 *
 * Use cases:
 * - Intended as a fallback when `project.canonical_deployment.id` is not
 *   available (see {@link getCanonicalProductionDeploymentId} for the
 *   authoritative method).
 *
 * Notes & caveats:
 * - This is a **best-effort** guess; it may be wrong if Cloudflare reports a
 *   successful build that is not currently serving production (e.g., manual
 *   rollbacks/promotions) or if timestamps are unusual. Prefer the canonical
 *   approach when possible.
 * - Interprets `created_on` as ISO-8601 (UTC) and compares by epoch ms.
 * - If there are **no** production deployments, returns `undefined`.
 * - This function is pure and performs no I/O.
 *
 * @param deployments - Mixed list of deployments (both envs allowed); only
 *   `environment === "production"` are considered. Each item should include
 *   `id`, `created_on`, `environment`, and optionally `latest_stage.status`.
 *
 * @returns The guessed active production deployment ID, or `undefined` if none.
 *
 * @example
 * const id = detectActiveProduction([
 *   { id: "p-old", created_on: "2024-12-01T00:00:00Z", environment: "production", latest_stage: { status: "success" } },
 *   { id: "p-new-failed", created_on: "2024-12-02T00:00:00Z", environment: "production", latest_stage: { status: "failure" } },
 *   { id: "preview-1", created_on: "2024-12-03T00:00:00Z", environment: "preview" }
 * ]);
 * // → "p-old" (newest successful production; newer failed build is ignored)
 */
export function detectActiveProduction(
  deployments: Deployment[],
): string | undefined {
  const prod = deployments.filter((d) => d.environment === "production");
  prod.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  return prod[0]?.id;
}

/**
 * Predicate that marks a deployment as **protected** when it has one or more
 * aliases/custom domains attached.
 *
 * Semantics:
 * - Returns `true` iff `d.aliases` is an `Array` with **length > 0**.
 * - Treats `undefined`, `null`, or an empty array (`[]`) as **not** protected.
 * - Does **not** validate alias formats; it merely checks presence.
 *
 * Usage:
 * - Alias-attached deployments are skipped from deletion and recorded under
 *   `skippedProtectedIds` in the report.
 *
 * Notes:
 * - The Cloudflare SDK may omit `aliases` for some records; this function
 *   handles that gracefully (returns `false`).
 * - This function is pure and performs no I/O.
 *
 * @param d - The deployment to inspect.
 * @returns `true` if one or more aliases are present; otherwise `false`.
 *
 * @example
 * hasAliases({ id: "x", created_on: "...", environment: "preview", aliases: ["staging.example.com"] })
 * // → true
 *
 * hasAliases({ id: "y", created_on: "...", environment: "production" })
 * // → false
 */
export function hasAliases(d: Deployment): boolean {
  return Array.isArray(d.aliases) && d.aliases.length > 0;
}
