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

import * as fs from "node:fs";
import * as core from "@actions/core";
import { DefaultArtifactClient } from "@actions/artifact";
import { Report, SelectionBucket } from "./types";
import { errorMessage } from "./utils";

/**
 * Initializes a fresh {@link Report} object from required base fields.
 *
 * Sets an empty `errors` array and zeroed `summary` counters. Use
 * {@link attachBucket} to merge per-environment results and
 * {@link addError} to record failures. This function is pure (it does not
 * mutate `base`) and does not write files or upload artifacts.
 *
 * @param base - The non-derivable report metadata (e.g., `project`, `accountId`,
 *   `environment`, `dryRun`, `runAt`, and `inputs`). The `summary` and `errors`
 *   properties are intentionally excluded and will be created here.
 *
 * @returns A fully initialized {@link Report} ready to be populated and then
 *   passed to `writeAndUploadReport` and `writeStepSummary`.
 *
 * @example
 * const report = initReport({
 *   project: inputs.project,
 *   accountId: inputs.accountId,
 *   environment: inputs.environment,
 *   dryRun: inputs.dryRun,
 *   runAt: new Date().toISOString(),
 *   inputs: {
 *     minToKeep: inputs.minToKeep,
 *     maxToKeep: inputs.maxToKeep,
 *     olderThanDays: inputs.olderThanDays,
 *     maxDeletesPerRun: inputs.maxDeletesPerRun,
 *     failOnError: inputs.failOnError
 *   }
 * });
 */
export function initReport(base: Omit<Report, "summary" | "errors">): Report {
  return {
    ...base,
    summary: {
      considered: 0,
      kept: 0,
      deleted: 0,
      skippedProtected: 0,
      skippedUndeletable: 0,
      errors: 0,
    },
    errors: [],
  };
}

/**
 * Merges a per-environment selection result into the aggregate {@link Report}.
 *
 * Effects:
 *  - Sets `report[env] = bucket` to store the environment-specific IDs.
 *  - Increments `report.summary` counters using the bucket sizes and the
 *    provided `considered` count (i.e., totals accumulate across envs).
 *
 * Note: This function **mutates** `report` and **adds** to the summary.
 * Call it **once per environment**. Re-attaching the same `env` a second time
 * will overwrite `report[env]` but also inflate the summary counters.
 *
 * @param report - The report object to update.
 * @param env - The environment the bucket belongs to (`"production"` or `"preview"`).
 * @param bucket - ID sets for kept/deleted/protected/undeletable items.
 * @param considered - Number of candidates examined beyond the retention window
 *   for this environment (used to increment `summary.considered`).
 *
 * @returns void
 *
 * @example
 * const prod = selectForEnvironment(/* ... *\/);
 * attachBucket(report, "production", prod.bucket, prod.consideredCount);
 *
 * const prev = selectForEnvironment(/* ... *\/);
 * attachBucket(report, "preview", prev.bucket, prev.consideredCount);
 */
export function attachBucket(
  report: Report,
  env: "production" | "preview",
  bucket: SelectionBucket,
  considered: number,
) {
  report[env] = bucket;
  report.summary.considered += considered;
  report.summary.kept += bucket.keptIds.length;
  report.summary.deleted += bucket.deletedIds.length;
  report.summary.skippedProtected += bucket.skippedProtectedIds.length;
  report.summary.skippedUndeletable += bucket.skippedUndeletableIds.length;
}

export function addError(report: Report, entry: Report["errors"][number]) {
  report.errors.push(entry);
  report.summary.errors = report.errors.length;
}

/**
 * Writes the run report to `./report.json` and uploads it as a GitHub Actions
 * artifact using **@actions/artifact v2**.
 *
 * Behavior:
 * - Serializes `report` (pretty-printed) to `report.json` in the workspace.
 * - Uploads a **single, immutable** artifact named `artifactName` via
 *   `DefaultArtifactClient`. Artifact names **must be unique per job/run** and
 *   cannot be appended to later (v2 constraint). Each job may create up to 10
 *   artifacts.
 * - On upload failure, logs a warning and **does not throw**. The caller
 *   (main flow) decides whether the job should fail (e.g., based on
 *   `failOnError` which applies to deletion errors).
 *
 * Notes:
 * - You can later expose artifact options (e.g., `retentionDays`,
 *   `compressionLevel`) via this function’s options if needed.
 * - This function is I/O bound (writes a file and performs a network upload).
 *
 * @param report - The finalized {@link Report} to persist and upload.
 * @param artifactName - A unique name for the artifact (include run/job IDs to
 *   avoid v2 duplicate-name errors).
 * @returns A promise that resolves when the artifact upload attempt completes.
 *
 * @example
 * const name = `cloudflare-pages-cleanup-report-${runId}-${attempt}`;
 * await writeAndUploadReport(report, name);
 */
export async function writeAndUploadReport(
  report: Report,
  artifactName: string,
): Promise<void> {
  const path = "report.json";
  fs.writeFileSync(path, JSON.stringify(report, null, 2), "utf8");

  const client = new DefaultArtifactClient();
  try {
    const { id, size } = await client.uploadArtifact(
      artifactName,
      [path],
      "/",
      {},
    );
    core.info(
      `Uploaded artifact '${artifactName}' (id: ${id}, bytes: ${size})`,
    );
  } catch (err: unknown) {
    core.warning(
      `Failed to upload artifact '${artifactName}': ${errorMessage(err)}`,
    );
  }
}
