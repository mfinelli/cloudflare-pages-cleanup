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

import { describe, it, expect } from "vitest";
import { selectForEnvironment } from "./select";
import { detectActiveProduction, hasAliases } from "./cloudflare";
import type { Deployment } from "./types";

function dep(
  id: string,
  opts: {
    env: "production" | "preview";
    daysAgo: number;
    aliases?: string[];
    branch?: string;
  },
): Deployment {
  const { env, daysAgo, aliases = [], branch } = opts;
  const created_on = new Date(
    Date.now() - daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    id,
    created_on,
    environment: env,
    aliases,
    deployment_trigger: branch ? { metadata: { branch } } : undefined,
  } as Deployment;
}

describe("selectForEnvironment – production basics", () => {
  it("keeps newest up to maxToKeep and deletes the rest", () => {
    // 8 prod deployments, d0 newest … d7 oldest
    const deployments = [
      dep("d0", { env: "production", daysAgo: 0 }),
      dep("d1", { env: "production", daysAgo: 1 }),
      dep("d2", { env: "production", daysAgo: 2 }),
      dep("d3", { env: "production", daysAgo: 3 }),
      dep("d4", { env: "production", daysAgo: 10 }),
      dep("d5", { env: "production", daysAgo: 20 }),
      dep("d6", { env: "production", daysAgo: 30 }),
      dep("d7", { env: "production", daysAgo: 40 }),
    ];

    const activeProdId = "d0"; // protect the newest
    const { bucket, consideredCount } = selectForEnvironment({
      env: "production",
      deployments,
      activeProdId,
      minToKeep: 5,
      maxToKeep: 5,
      olderThanMs: undefined,
    });

    // Top 5 kept (including active d0), bottom 3 deleted
    expect(new Set(bucket.keptIds)).toEqual(
      new Set(["d0", "d1", "d2", "d3", "d4"]),
    );
    expect(new Set(bucket.deletedIds)).toEqual(new Set(["d5", "d6", "d7"]));
    // Active prod should be marked protected
    expect(bucket.skippedProtectedIds).toContain("d0");
    // All 3 beyond cap were considered
    expect(consideredCount).toBe(3);
  });

  it("applies age filter only to candidates beyond maxToKeep", () => {
    // KeepCut = max(min,max) = 2; candidates: d2,d3,d4
    const deployments = [
      dep("d0", { env: "production", daysAgo: 0 }),
      dep("d1", { env: "production", daysAgo: 1 }),
      dep("d2", { env: "production", daysAgo: 5 }), // newer than 10 → kept
      dep("d3", { env: "production", daysAgo: 9 }), // newer than 10 → kept
      dep("d4", { env: "production", daysAgo: 11 }), // older than 10 → delete
    ];
    const olderThanMs = Date.now() - 10 * 24 * 60 * 60 * 1000;

    const { bucket, consideredCount } = selectForEnvironment({
      env: "production",
      deployments,
      activeProdId: "d0",
      minToKeep: 0,
      maxToKeep: 2,
      olderThanMs,
    });

    expect(new Set(bucket.keptIds)).toEqual(new Set(["d0", "d1", "d2", "d3"]));
    expect(bucket.deletedIds).toEqual(["d4"]);
    expect(bucket.skippedProtectedIds).toContain("d0");
    // candidates considered: d2,d3,d4
    expect(consideredCount).toBe(3);
  });

  it("protects alias-attached deployments", () => {
    const deployments = [
      dep("d0", { env: "production", daysAgo: 0 }),
      dep("d1", {
        env: "production",
        daysAgo: 1,
        aliases: ["staging.example.com"],
      }), // protected
      dep("d2", { env: "production", daysAgo: 2 }),
      dep("d3", { env: "production", daysAgo: 30 }),
    ];

    const { bucket } = selectForEnvironment({
      env: "production",
      deployments,
      activeProdId: "d0",
      minToKeep: 1,
      maxToKeep: 1,
      olderThanMs: undefined,
    });

    // keepCut=1 → only d0 auto-kept; d1 (alias) must be protected+kept
    expect(bucket.skippedProtectedIds).toContain("d1");
    expect(bucket.keptIds).toContain("d1");
    expect(bucket.deletedIds).toEqual(expect.arrayContaining(["d2", "d3"]));
  });
});

describe("selectForEnvironment – preview branch latest undeletable", () => {
  it("skips newest per branch as undeletable; deletes older ones", () => {
    const deployments = [
      // feat1 newest and older
      dep("p1_new", { env: "preview", daysAgo: 2, branch: "feat1" }),
      dep("p1_old", { env: "preview", daysAgo: 20, branch: "feat1" }),
      // feat2 only one → newest by definition
      dep("p2_new", { env: "preview", daysAgo: 3, branch: "feat2" }),
    ];

    // keepCut=0 → everything is a candidate unless protected/undeletable
    const { bucket, consideredCount } = selectForEnvironment({
      env: "preview",
      deployments,
      activeProdId: undefined,
      minToKeep: 0,
      maxToKeep: 0,
      olderThanMs: undefined,
    });

    // Newest per branch marked undeletable (kept)
    expect(new Set(bucket.skippedUndeletableIds)).toEqual(
      new Set(["p1_new", "p2_new"]),
    );
    expect(new Set(bucket.keptIds)).toEqual(new Set(["p1_new", "p2_new"]));
    // Older of feat1 can be deleted
    expect(bucket.deletedIds).toEqual(["p1_old"]);
    // All 3 were considered (since keepCut=0 and none are alias/active prod)
    expect(consideredCount).toBe(3);
  });
});

describe("helpers", () => {
  it("detectActiveProduction picks the newest production deployment", () => {
    const deployments = [
      dep("x-old", { env: "production", daysAgo: 7 }),
      dep("x-new", { env: "production", daysAgo: 1 }),
      dep("p-prev", { env: "preview", daysAgo: 0 }),
    ];
    const id = detectActiveProduction(deployments);
    expect(id).toBe("x-new");
  });

  it("hasAliases returns true when aliases present", () => {
    expect(
      hasAliases(dep("a", { env: "preview", daysAgo: 1, aliases: ["foo"] })),
    ).toBe(true);
    expect(hasAliases(dep("b", { env: "preview", daysAgo: 1 }))).toBe(false);
  });
});
