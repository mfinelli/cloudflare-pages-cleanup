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

import { describe, expect, it } from "vitest";
import { addError, initReport } from "./report";

describe("addError", () => {
  function baseReport() {
    return initReport({
      project: "proj",
      accountId: "acc",
      environment: "all",
      dryRun: true,
      runAt: "2025-01-01T00:00:00.000Z",
      inputs: {
        minToKeep: 5,
        maxToKeep: 50,
        olderThanDays: undefined,
        maxDeletesPerRun: 50,
        failOnError: true,
      },
    });
  }

  it("appends an error and increments the summary count", () => {
    const report = baseReport();
    expect(report.errors).toHaveLength(0);
    expect(report.summary.errors).toBe(0);

    addError(report, {
      deploymentId: "dep-1",
      status: 403,
      message: "Forbidden",
      environment: "preview",
    });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({
      deploymentId: "dep-1",
      status: 403,
      message: "Forbidden",
      environment: "preview",
    });
    expect(report.summary.errors).toBe(1);

    // add another to ensure it keeps counting
    addError(report, {
      deploymentId: "dep-2",
      status: 500,
      message: "Server error",
      environment: "production",
    });

    expect(report.errors).toHaveLength(2);
    expect(report.summary.errors).toBe(2);
  });

  it("does not change unrelated summary fields", () => {
    const report = baseReport();

    // Prime some other summary numbers to ensure addError doesn't touch them
    report.summary.considered = 10;
    report.summary.kept = 7;
    report.summary.deleted = 3;
    report.summary.skippedProtected = 1;
    report.summary.skippedUndeletable = 2;

    addError(report, {
      deploymentId: "dep-3",
      status: 404,
      message: "Not found",
      environment: "preview",
    });

    expect(report.summary.considered).toBe(10);
    expect(report.summary.kept).toBe(7);
    expect(report.summary.deleted).toBe(3);
    expect(report.summary.skippedProtected).toBe(1);
    expect(report.summary.skippedUndeletable).toBe(2);
  });
});
