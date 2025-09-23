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
 * v2 artifact upload:
 * - Requires a unique artifact name per job/run
 * - Single-shot upload; cannot append to the same artifact name again
 * - We warn on failure but don't hard-fail here (the main flow decides based on failOnError)
 */
export async function writeAndUploadReport(
  report: Report,
  artifactName: string,
): Promise<void> {
  const path = "report.json";
  fs.writeFileSync(path, JSON.stringify(report, null, 2), "utf8");

  const client = new DefaultArtifactClient();
  try {
    // const { id, size } = await client.uploadArtifact(artifactName, [path], {
    //   // Optional knobs you can expose later:
    //   // retentionDays: undefined,
    //   // compressionLevel: 6,
    // });
    const { id, size } = await client.uploadArtifact(
      artifactName,
      [path],
      "/",
      {},
    );
    core.info(
      `Uploaded artifact '${artifactName}' (id: ${id}, bytes: ${size})`,
    );
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    core.warning(`Failed to upload artifact '${artifactName}': ${msg}`);
  }
}
