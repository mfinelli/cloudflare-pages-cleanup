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
import { getInputs, daysAgoUtc, nowUtcIso } from "./utils";
import {
  deleteDeployment,
  detectActiveProduction,
  hasAliases,
  listDeployments,
} from "./cloudflare";
import { selectForEnvironment } from "./select";
import {
  initReport,
  attachBucket,
  addError,
  writeAndUploadReport,
} from "./report";
import { writeStepSummary } from "./summary";
import { Environment } from "./types";
// Docs for endpoints/fields we rely on: list + delete deployments (aliases, created_on, env).
// List: https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/list/
// Delete: https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/delete/

async function run(): Promise<void> {
  const inputs = getInputs();

  const report = initReport({
    project: inputs.project,
    accountId: inputs.accountId,
    environment: inputs.environment,
    dryRun: inputs.dryRun,
    runAt: nowUtcIso(),
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
  const all: Record<Environment, any[]> = { production: [], preview: [] };
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
  const activeProdId = envs.includes("production")
    ? detectActiveProduction(all["production"])
    : undefined;

  const olderThanMs =
    inputs.olderThanDays !== undefined
      ? daysAgoUtc(inputs.olderThanDays)
      : undefined;

  for (const env of envs) {
    const deployments = all[env];

    // Pre-filter to exclude alias-attached deployments from even being considered (still counted as kept/protected)
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
        } catch (e: any) {
          const message =
            typeof e?.message === "string" ? e.message : String(e);
          // Try to parse status number from message if present
          const status = Number((message.match(/\((\d{3})\)/) || [])[1]) || 0;
          addError(report, {
            deploymentId: id,
            status,
            message,
            environment: env,
          });
          if (inputs.failOnError) {
            // still write artifacts/summary later; we won't early-exit so we can report more errors in one go
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
  const msg = err instanceof Error ? err.message : String(err);
  core.setFailed(msg);
});
