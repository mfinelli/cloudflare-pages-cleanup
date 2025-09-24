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

import * as core from "@actions/core";
import { daysAgoUtc, errorMessage, getInputs } from "./utils";
import {
  deleteDeployment,
  detectActiveProduction,
  getCanonicalProductionDeploymentId,
  hasAliases,
  listDeployments,
} from "./cloudflare";
import { selectForEnvironment } from "./select";
import {
  addError,
  attachBucket,
  initReport,
  writeAndUploadReport,
} from "./report";
import { writeStepSummary } from "./summary";
import { Deployment, Environment } from "./types";

/**
 * Orchestrates the Cloudflare Pages cleanup action end-to-end.
 *
 * Workflow:
 *  1) Reads and validates inputs via {@link getInputs}.
 *  2) Creates a fresh {@link Report} with {@link initReport} (records `runAt`, inputs, etc.).
 *  3) Determines which environments to process (`production`, `preview`, or both).
 *  4) Lists deployments per environment using the Cloudflare TS SDK
 *     ({@link listDeployments}); detects the active production deployment via
 *     {@link detectActiveProduction}.
 *  5) Computes the optional age cutoff (`olderThanMs`) with {@link daysAgoUtc}.
 *  6) For each environment:
 *     - Runs {@link selectForEnvironment} to classify IDs to keep/delete/skip.
 *     - Ensures alias-attached deployments are marked protected (via {@link hasAliases}).
 *     - If **not** in dry-run, deletes up to `maxDeletesPerRun` candidates using
 *       {@link deleteDeployment}; aggregates any errors with {@link addError}
 *       (no early exit, so multiple failures are reported together).
 *     - Merges results into the report with {@link attachBucket}.
 *  7) Sets GitHub Action outputs (`consideredCount`, `deletedCount`, `keptCount`, `deletedIds`).
 *  8) Always writes and uploads `report.json` as an artifact (unique name derived from
 *     `GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT`/`GITHUB_JOB`) via {@link writeAndUploadReport}.
 *  9) Writes a human-readable step summary via {@link writeStepSummary}.
 * 10) If any deletion errors occurred and `failOnError` is true, throws to fail the job.
 *
 * Side effects:
 *  - Network calls to Cloudflare's API (list/delete deployments).
 *  - Writes `report.json` to the workspace and uploads it as an artifact.
 *  - Writes a GitHub Step Summary.
 *  - Sets Action outputs; may fail the job on policy.
 *
 * Notes:
 *  - Dry-run mode performs all selection/reporting but **does not delete** anything.
 *  - Artifact upload failures are logged as warnings; they do **not** fail the job here.
 *  - Errors from deletion are aggregated and can fail the job depending on `failOnError`.
 *  - Sensitive values (tokens) are never logged.
 *
 * @returns Promise that resolves when the run completes (or rejects to fail the job).
 * @throws If inputs are invalid; if listing deployments fails; or (when `failOnError` is true)
 *         if one or more deletions fail after retries.
 */
async function run(): Promise<void> {
  const inputs = getInputs();

  const report = initReport({
    project: inputs.project,
    accountId: inputs.accountId,
    environment: inputs.environment,
    dryRun: inputs.dryRun,
    runAt: new Date().toISOString(),
    inputs: {
      minToKeep: inputs.minToKeep,
      maxToKeep: inputs.maxToKeep,
      olderThanDays: inputs.olderThanDays,
      maxDeletesPerRun: inputs.maxDeletesPerRun,
      failOnError: inputs.failOnError,
    },
  });

  // Determine which envs to process
  const envs: Environment[] =
    inputs.environment === "all"
      ? ["production", "preview"]
      : [inputs.environment];

  // Fetch once per env to let Cloudflare filter server-side
  const all: Record<Environment, Deployment[]> = {
    production: [],
    preview: [],
  };
  for (const env of envs) {
    const list = await listDeployments({
      accountId: inputs.accountId,
      apiToken: inputs.apiToken,
      project: inputs.project,
      env,
    });
    all[env] = list;
  }

  // Active production protection (computed from production list)
  let activeProdId: string | undefined = undefined;

  if (envs.includes("production")) {
    const canonical = await getCanonicalProductionDeploymentId({
      accountId: inputs.accountId,
      apiToken: inputs.apiToken,
      project: inputs.project,
    });

    activeProdId = canonical ?? detectActiveProduction(all["production"]);

    if (!canonical) {
      core.info(
        `Using heuristic active production ID: ${activeProdId ?? "unknown"} (canonical_deployment not available)`,
      );
    } else {
      core.info(`Active production deployment (canonical): ${canonical}`);
    }
  }

  const olderThanMs =
    inputs.olderThanDays !== undefined
      ? daysAgoUtc(inputs.olderThanDays)
      : undefined;

  for (const env of envs) {
    const deployments = all[env];

    // Pre-filter to exclude alias-attached deployments from even being
    // considered (still counted as kept/protected)
    const protectedAliasIds = new Set(
      deployments.filter(hasAliases).map((d) => d.id),
    );

    // Selection (handles floors/caps, age, branch-latest undeletable for preview)
    const { bucket, consideredCount } = selectForEnvironment({
      env,
      deployments,
      activeProdId,
      minToKeep: inputs.minToKeep,
      maxToKeep: inputs.maxToKeep,
      olderThanMs,
    });

    // Merge explicit alias-protection flag into skippedProtected (if not already there)
    for (const d of deployments) {
      if (
        protectedAliasIds.has(d.id) &&
        !bucket.skippedProtectedIds.includes(d.id)
      ) {
        bucket.skippedProtectedIds.push(d.id);
        if (!bucket.keptIds.includes(d.id)) bucket.keptIds.push(d.id);
      }
    }

    // Deletion (honor maxDeletesPerRun)
    const toDelete = bucket.deletedIds.slice(0, inputs.maxDeletesPerRun);

    if (inputs.dryRun) {
      core.info(
        `[${env}] DRY RUN: would delete ${toDelete.length} deployments`,
      );
    } else {
      let idx = 0;
      for (const id of toDelete) {
        idx++;
        try {
          await deleteDeployment({
            accountId: inputs.accountId,
            apiToken: inputs.apiToken,
            project: inputs.project,
            deploymentId: id,
          });
          core.info(`[${env}] Deleted ${idx}/${toDelete.length}: ${id}`);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          // Try to parse status number from message if present
          const status = Number((message.match(/\((\d{3})\)/) || [])[1]) || 0;
          addError(report, {
            deploymentId: id,
            status,
            message,
            environment: env,
          });
          if (inputs.failOnError) {
            // still write artifacts/summary later; we won't early-exit so we
            // can report more errors in one go
          }
        }
      }
    }

    attachBucket(report, env, bucket, consideredCount);
  }

  // Outputs
  core.setOutput("consideredCount", report.summary.considered);
  core.setOutput("deletedCount", report.summary.deleted);
  core.setOutput("keptCount", report.summary.kept);
  const deletedIdsCsv = [
    ...(report.production?.deletedIds ?? []),
    ...(report.preview?.deletedIds ?? []),
  ].join(",");
  core.setOutput("deletedIds", deletedIdsCsv);

  // Build a unique artifact name (per job/run)
  const runId = process.env.GITHUB_RUN_ID ?? "run";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const job = process.env.GITHUB_JOB ?? "job";
  const artifactName = `cloudflare-pages-cleanup-report-${inputs.project}-${inputs.environment}-${runId}-${attempt}-${job}`;

  // Always write/upload report and step summary
  await writeAndUploadReport(report, artifactName);
  await writeStepSummary(report);

  // Fail if any errors and policy says so
  if (report.summary.errors > 0) {
    if (!inputs.failOnError) {
      // Safety in case user overrides later
      core.warning(
        `Deletion errors occurred, but failOnError=false; continuing.`,
      );
      return;
    }
    throw new Error(`Deletion errors occurred: ${report.summary.errors}`);
  }
}

run().catch((err) => {
  // Ensure a clean failure with message
  core.setFailed(errorMessage(err));
});
