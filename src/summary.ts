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
import { Report } from "./types";

/**
 * Renders a human-friendly **GitHub Step Summary** for a cleanup run.
 *
 * Produces a Markdown summary with:
 *  - A header and run context (project, environment selector, dry-run flag)
 *  - Aggregated totals (considered, deleted, kept, protected, undeletable, errors)
 *  - Per-environment sections (`production`, `preview`) using collapsible
 *    `<details>` blocks for:
 *      - Deleted IDs
 *      - Kept IDs (includes protected and within-retention)
 *      - Protected IDs (active prod, alias-attached)
 *      - Undeletable IDs (e.g., latest per branch that CF forbids deleting)
 *  - An error table (env, deploymentId, HTTP status, message) when any errors occurred
 *
 * Notes:
 *  - Uses `@actions/core.summary` to write to the file referenced by
 *    `GITHUB_STEP_SUMMARY`. In a local/non-Actions context, this may be a no-op.
 *  - This function is presentation-only; it does not mutate `report` and
 *    does not throw unless the summary write fails.
 *  - Long ID lists are collapsed by default to keep the summary compact.
 *
 * @param report - The finalized report object (typically the same one uploaded as `report.json`).
 * @returns A promise that resolves once the summary has been written.
 *
 * @example
 * const report = /* build or load report *\/
 * await writeStepSummary(report);
 */
export async function writeStepSummary(report: Report): Promise<void> {
  const lines: string[] = [];
  lines.push(`### Cloudflare Pages Cleanup`);
  lines.push("");
  lines.push(
    `**Project:** \`${report.project}\`  \n**Environment:** \`${report.environment}\`  \n**Dry Run:** \`${report.dryRun}\``,
  );
  lines.push("");
  lines.push(
    `**Considered:** ${report.summary.considered}  |  **Deleted:** ${report.summary.deleted}  |  **Kept:** ${report.summary.kept}`,
  );
  lines.push(
    `**Protected:** ${report.summary.skippedProtected}  |  **Undeletable:** ${report.summary.skippedUndeletable}  |  **Errors:** ${report.summary.errors}`,
  );
  lines.push("");

  for (const env of ["production", "preview"] as const) {
    const bucket = report[env];
    if (!bucket) continue;
    lines.push(`#### ${env} `);
    if (bucket.deletedIds.length) {
      lines.push(
        `<details><summary>Deleted (${bucket.deletedIds.length})</summary>\n\n\`${bucket.deletedIds.join(", ")}\`\n\n</details>`,
      );
    } else {
      lines.push(`_Deleted_: 0`);
    }
    if (bucket.keptIds.length) {
      lines.push(
        `<details><summary>Kept (${bucket.keptIds.length})</summary>\n\n\`${bucket.keptIds.join(", ")}\`\n\n</details>`,
      );
    }
    if (bucket.skippedProtectedIds.length) {
      lines.push(
        `<details><summary>Protected (${bucket.skippedProtectedIds.length})</summary>\n\n\`${bucket.skippedProtectedIds.join(", ")}\`\n\n</details>`,
      );
    }
    if (bucket.skippedUndeletableIds.length) {
      lines.push(
        `<details><summary>Undeletable (${bucket.skippedUndeletableIds.length})</summary>\n\n\`${bucket.skippedUndeletableIds.join(", ")}\`\n\n</details>`,
      );
    }
    lines.push("");
  }

  if (report.errors.length) {
    lines.push(`#### Errors`);
    lines.push("");
    lines.push("| env | deploymentId | status | message |");
    lines.push("|---|---|---:|---|");
    for (const e of report.errors) {
      lines.push(
        `| ${e.environment} | \`${e.deploymentId}\` | ${e.status} | ${e.message.replace(/\n/g, " ")} |`,
      );
    }
    lines.push("");
  }

  await core.summary.addRaw(lines.join("\n")).write();
}
