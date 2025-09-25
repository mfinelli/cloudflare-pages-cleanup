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

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @actions/core BEFORE importing getInputs
vi.mock("@actions/core", () => {
  const store: Record<string, string | undefined> = {};
  return {
    getInput: vi.fn((name: string, opts?: { required?: boolean }) => {
      const v = store[name];
      if (opts?.required && (!v || v === "")) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return v ?? "";
    }),
    warning: vi.fn(),
    info: vi.fn(),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
    // test-only helper to seed inputs
    __setMockInputs: (obj: Record<string, string | undefined>) => {
      for (const k of Object.keys(store)) delete store[k];
      Object.assign(store, obj);
    },
  };
});

import * as core from "@actions/core";
import { getInputs } from "../src/utils";

function setInputs(values: Record<string, string | undefined>) {
  (
    core as unknown as {
      __setMockInputs: (v: Record<string, string | undefined>) => void;
    }
  ).__setMockInputs(values);
}

describe("getInputs", () => {
  beforeEach(() => {
    setInputs({}); // clear between tests
    vi.clearAllMocks();
  });

  it("throws when required inputs are missing", () => {
    // no accountId/apiToken/project
    expect(() => getInputs()).toThrow(
      /Input required and not supplied: cloudflare_account_id/,
    );
  });

  it("applies sensible defaults when optional inputs are omitted", () => {
    setInputs({
      cloudflare_account_id: "acc",
      cloudflare_api_token: "tok",
      project: "proj",
      // everything else omitted
    });
    const got = getInputs();
    expect(got.environment).toBe("all");
    expect(got.minToKeep).toBe(5);
    expect(got.maxToKeep).toBe(10);
    expect(got.olderThanDays).toBeUndefined();
    expect(got.dryRun).toBe(true);
    expect(got.maxDeletesPerRun).toBe(50);
    expect(got.failOnError).toBe(true);
  });

  it("parses provided values and booleans", () => {
    setInputs({
      cloudflare_account_id: "acc",
      cloudflare_api_token: "tok",
      project: "proj",
      environment: "preview",
      "min-to-keep": "7",
      "max-to-keep": "10",
      "only-older-than-days": "30",
      dry_run: "false",
      "max-deletes-per-run": "20",
      fail_on_error: "false",
    });
    const got = getInputs();
    expect(got.environment).toBe("preview");
    expect(got.minToKeep).toBe(7);
    expect(got.maxToKeep).toBe(10);
    expect(got.olderThanDays).toBe(30);
    expect(got.dryRun).toBe(false);
    expect(got.maxDeletesPerRun).toBe(20);
    expect(got.failOnError).toBe(false);
  });

  it("normalizes maxToKeep < minToKeep and warns", () => {
    setInputs({
      cloudflare_account_id: "acc",
      cloudflare_api_token: "tok",
      project: "proj",
      "min-to-keep": "20",
      "max-to-keep": "10",
    });
    const got = getInputs();
    expect(got.minToKeep).toBe(20);
    expect(got.maxToKeep).toBe(20); // coerced up to min
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringMatching(/maxToKeep.*<.*minToKeep/),
    );
  });

  it("rejects invalid environment", () => {
    setInputs({
      cloudflare_account_id: "acc",
      cloudflare_api_token: "tok",
      project: "proj",
      environment: "bogus",
    });
    expect(() => getInputs()).toThrow(/Invalid environment 'bogus'/);
  });

  it("rejects negative olderThanDays", () => {
    setInputs({
      cloudflare_account_id: "acc",
      cloudflare_api_token: "tok",
      project: "proj",
      "only-older-than-days": "-1",
    });
    expect(() => getInputs()).toThrow(/olderThanDays must be >= 0/);
  });

  it("rejects non-integer numeric strings via parseIntStrict", () => {
    setInputs({
      cloudflare_account_id: "acc",
      cloudflare_api_token: "tok",
      project: "proj",
      "max-deletes-per-run": "3.14",
    });
    expect(() => getInputs()).toThrow(/Expected integer, got '3\.14'/);
  });

  it("defaults emitReportArtifact and emitStepSummary to true", () => {
    setInputs({
      cloudflare_account_id: "acc",
      cloudflare_api_token: "tok",
      project: "proj",
    });
    const got = getInputs();
    expect(got.emitReportArtifact).toBe(true);
    expect(got.emitStepSummary).toBe(true);
  });

  it("parses emitReportArtifact/emitStepSummary when provided", () => {
    setInputs({
      cloudflare_account_id: "acc",
      cloudflare_api_token: "tok",
      project: "proj",
      emit_report_artifact: "false",
      emit_step_summary: "false",
    });
    const got = getInputs();
    expect(got.emitReportArtifact).toBe(false);
    expect(got.emitStepSummary).toBe(false);
  });
});
