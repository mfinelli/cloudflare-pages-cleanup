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

export interface Inputs {
  accountId: string;
  apiToken: string;
  project: string;
  environment: EnvSelector;
  minToKeep: number;
  maxToKeep: number;
  olderThanDays?: number;
  dryRun: boolean;
  maxDeletesPerRun: number;
  failOnError: boolean;
}

export interface Deployment {
  id: string;
  short_id?: string;
  created_on: string;
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

export interface SelectionBucket {
  keptIds: string[];
  deletedIds: string[];
  skippedProtectedIds: string[];
  skippedUndeletableIds: string[];
}

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
  summary: {
    considered: number;
    kept: number;
    deleted: number;
    skippedProtected: number;
    skippedUndeletable: number;
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
