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

export type Environment = "production" | "preview";
export type EnvSelector = "all" | Environment;

/** Parsed and validated action inputs.
 * @remarks
 * - All time logic is UTC.
 * - `minToKeep` and `maxToKeep` are enforced **per environment**.
 * - If `maxToKeep < minToKeep`, `maxToKeep` is coerced up and a warning is logged.
 */
export interface Inputs {
  /** Cloudflare account ID. */
  accountId: string;
  /** API token with Pages read+edit. */
  apiToken: string;
  /** Single Pages project name. */
  project: string;
  /** Which environment(s) to process. @defaultValue "all" */
  environment: EnvSelector;
  /** Per-environment floor to always keep. @defaultValue 5 */
  minToKeep: number;
  /** Per-environment cap of newest to retain (>= min). @defaultValue 10 */
  maxToKeep: number;
  /** Only delete items older than this many days; unset = no age filter. */
  olderThanDays?: number;
  /** If true, only report; no deletes. @defaultValue true */
  dryRun: boolean;
  /** Safety cap on deletions per run. @defaultValue 50 */
  maxDeletesPerRun: number;
  /** Any delete error fails the job when true. @defaultValue true */
  failOnError: boolean;
  /** If true, upload report.json as an artifact */
  emitReportArtifact: boolean;
  /** If true, write a GitHub step summary */
  emitStepSummary: boolean;
}

/** Minimal deployment shape used by selection logic.
 * @remarks
 * - Derived from Cloudflare TS SDK; fields may be optional.
 * - `created_on` is ISO-8601 (UTC).
 * - If `aliases` is non-empty, the deployment is treated as protected.
 */
export interface Deployment {
  id: string;
  short_id?: string;
  created_on: string; // ISO-8601 UTC
  environment: Environment;
  url?: string;
  aliases?: string[]; // presence implies alias/custom domain attached (protected)
  deployment_trigger?: {
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
  latest_stage?: { status?: string };
  source?: { config?: { production_branch?: string } };
}

/** IDs grouped by outcome for a single environment. */
export interface SelectionBucket {
  /** Kept this run (includes protected and within retention). */
  keptIds: string[];
  /** Deleted (or would be deleted in dry-run). */
  deletedIds: string[];
  /** Skipped due to protections (active prod, aliases, etc.). */
  skippedProtectedIds: string[];
  /** Skipped because Cloudflare forbids deleting latest per branch. */
  skippedUndeletableIds: string[];
}

/** JSON report emitted as an artifact and summarized in the step. */
export interface Report {
  project: string;
  accountId: string;
  environment: "all" | Environment;
  dryRun: boolean;
  runAt: string;
  inputs: {
    minToKeep: number;
    maxToKeep: number;
    olderThanDays?: number;
    maxDeletesPerRun: number;
    failOnError: boolean;
  };
  /** Aggregated totals across processed environments. */
  summary: {
    /** Candidates examined beyond retention caps. */
    considered: number;
    /** Total kept (includes protected + within caps). */
    kept: number;
    /** Total deleted (or would delete in dry-run). */
    deleted: number;
    /** Protected skips (aliases/active prod). */
    skippedProtected: number;
    /** Undeletable skips (latest per branch). */
    skippedUndeletable: number;
    /** Number of deletion errors encountered. */
    errors: number;
  };
  production?: SelectionBucket;
  preview?: SelectionBucket;
  errors: {
    deploymentId: string;
    status: number;
    message: string;
    environment: Environment;
  }[];
}
