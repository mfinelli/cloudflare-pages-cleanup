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
import { EnvSelector, Inputs } from "./types";

/**
 * Returns a human-readable message for an arbitrary thrown value.
 *
 * Designed for use in `catch (err: unknown)` blocks to keep type safety.
 * - If `err` is an `Error`, returns its `.message` (which may be empty).
 * - Otherwise, returns `String(err)` (uses the value's `toString()` if present).
 *
 * Note: This does not include stack traces or error names; it's intended for
 * concise logs and step summaries. Objects without a custom `toString()` will
 * yield `"[object Object]"`.
 *
 * @param err - The caught value (can be anything).
 * @returns A short, log-friendly message string.
 *
 * @example
 * try {
 *   // ...
 * } catch (e) {
 *   core.warning(`Upload failed: ${errorMessage(e)}`);
 * }
 *
 * @example
 * errorMessage(new Error("boom"))            // "boom"
 * errorMessage({ toString: () => "custom" }) // "custom"
 * errorMessage(42)                           // "42"
 * errorMessage(null)                         // "null"
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parses a boolean-like input string with a safe fallback.
 *
 * Accepts common truthy/falsy tokens (case- and whitespace-insensitive):
 *  - truthy:  "true", "1", "yes", "y"
 *  - falsy:   "false", "0", "no", "n"
 *
 * Behavior:
 *  - If `s` is `undefined` or not a string, returns `dflt`.
 *  - If `s` trims to an empty string, returns `dflt`.
 *  - If `s` matches a token above, returns the corresponding boolean.
 *  - Otherwise, returns `dflt`.
 *
 * This is intended for parsing GitHub Action inputs from `@actions/core.getInput`,
 * which always return strings; the non-string guard makes it resilient to misuse.
 *
 * @param s - The input value to parse (usually a string from getInput).
 * @param dflt - The default boolean to return when `s` is empty/unknown/invalid.
 * @returns The parsed boolean or the provided default.
 *
 * @example
 * parseBool(undefined, true)          // -> true
 * parseBool("  yes ", false)          // -> true
 * parseBool("0", true)                // -> false
 * parseBool("", false)                // -> false (empty → default)
 * parseBool(false as unknown as string, true) // -> true (non-string → default)
 */
export function parseBool(s: string | undefined, dflt: boolean): boolean {
  if (s == null) return dflt;
  if (typeof s !== "string") return dflt;
  const v = String(s).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;
  return dflt;
}

/**
 * Parses an input string into an integer with **strict** semantics.
 *
 * Rules:
 * - If `s` is `undefined` or trims to an empty string, return `dflt`.
 * - Trims whitespace before parsing.
 * - Uses `Number(t)` to parse, so numeric forms like `-7`, `003`, `0x10` (hex),
 *   and scientific notation like `1e3` are accepted **iff** they represent an
 *   integer value.
 * - Throws if the parsed value is not a finite integer (e.g. `"3.14"`, `"NaN"`,
 *   `"Infinity"`, or non-numeric strings).
 *
 * Intended for validating GitHub Action inputs where integers are expected.
 *
 * @param s - The raw input (usually from `core.getInput`).
 * @param dflt - The default to return when `s` is missing/empty.
 * @returns The parsed integer or `dflt` when `s` is missing/empty.
 * @throws Error if `s` is provided but does not parse to a finite integer.
 *
 * @example
 * parseIntStrict(undefined, 5)   // -> 5
 * parseIntStrict("   ", 7)       // -> 7
 * parseIntStrict("42", 0)        // -> 42
 * parseIntStrict("-7", 0)        // -> -7
 * parseIntStrict("1e3", 0)       // -> 1000
 * parseIntStrict("0x10", 0)      // -> 16
 * parseIntStrict("3.14", 0)      // throws: Expected integer, got '3.14'
 */
export function parseIntStrict(s: string | undefined, dflt: number): number {
  if (s == null || s === "") return dflt;
  const t = s.trim();
  if (t === "") return dflt;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Expected integer, got '${s}'`);
  }
  return n;
}

/**
 * Returns the UTC epoch timestamp (in milliseconds) for the instant
 * `days` days before the current time.
 *
 * Implementation detail:
 * - Uses `Date.now()` (UTC-based) and subtracts `days * 24h`, so the result
 *   is independent of local time zones and unaffected by DST transitions.
 *
 * Notes:
 * - Accepts fractional values (e.g., `1.5` ⇒ 36 hours).
 * - Negative values yield a timestamp in the **future** (e.g., `-2` ⇒ now + 2 days).
 *   Callers typically validate non-negative input upstream.
 *
 * Common use: compute a cutoff for “older than X days” comparisons.
 *
 * @param days - Number of days to subtract from now; may be fractional.
 * @returns Epoch milliseconds (UTC) representing the cutoff instant.
 *
 * @example
 * const cutoff = daysAgoUtc(30);
 * const isOlder = Date.parse(deployment.created_on) < cutoff;
 */
export function daysAgoUtc(days: number): number {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return ms;
}

/**
 * Reads, parses, and validates all GitHub Action inputs for this workflow.
 *
 * Sources values via `@actions/core.getInput`, applies trimming/coercion, and
 * enforces invariants:
 *  - `environment` must be one of: `"all" | "production" | "preview"`.
 *  - `minToKeep`, `maxToKeep`, `maxDeletesPerRun` must be non-negative integers.
 *  - `olderThanDays` (if provided) must be a non-negative integer.
 *  - If `maxToKeep < minToKeep`, it is coerced up to `minToKeep` and a warning is logged.
 *
 * Parsing rules:
 *  - Booleans use `parseBool` (safe defaults; case/whitespace-insensitive).
 *  - Integers use `parseIntStrict` (throws on non-integers like `"3.14"`).
 *  - All string inputs are trimmed.
 *
 * Defaults (when inputs are omitted):
 *  - `environment`: `"all"`
 *  - `minToKeep`: `5`
 *  - `maxToKeep`: `10`
 *  - `olderThanDays`: `undefined` (no age filter)
 *  - `dryRun`: `true`
 *  - `maxDeletesPerRun`: `50`
 *  - `failOnError`: `true`
 *
 * @returns {Inputs} A fully-validated configuration object ready for use.
 *
 * @throws {Error} If required fields are missing (`cloudflareAccountId`,
 *   `cloudflareApiToken`, `project`), if an input fails integer/boolean parsing,
 *   if any non-negative constraint is violated, or if `environment` is invalid.
 *
 * @example
 * // Typical usage in the action entrypoint:
 * const inputs = getInputs();
 * core.info(`Cleaning project ${inputs.project} (${inputs.environment})`);
 */
export function getInputs(): Inputs {
  const accountId = core
    .getInput("cloudflare_account_id", { required: true })
    .trim();
  const apiToken = core
    .getInput("cloudflare_api_token", { required: true })
    .trim();
  const project = core.getInput("project", { required: true }).trim();
  const environment = (core.getInput("environment") || "all")
    .trim()
    .toLowerCase() as EnvSelector;

  const minToKeep = parseIntStrict(core.getInput("min-to-keep"), 5);
  let maxToKeep = parseIntStrict(core.getInput("max-to-keep"), 10);
  const olderThanDaysStr = core.getInput("only-older-than-days");
  const olderThanDays = olderThanDaysStr
    ? parseIntStrict(olderThanDaysStr, 0)
    : undefined;

  const dryRun = parseBool(core.getInput("dry_run"), true);
  const maxDeletesPerRun = parseIntStrict(
    core.getInput("max-deletes-per-run"),
    50,
  );
  const failOnError = parseBool(core.getInput("fail_on_error"), true);
  const emitReportArtifact = parseBool(
    core.getInput("emit_report_artifact"),
    true,
  );
  const emitStepSummary = parseBool(core.getInput("emit_step_summary"), true);

  if (minToKeep < 0 || maxToKeep < 0 || maxDeletesPerRun < 0) {
    throw new Error("minToKeep, maxToKeep, maxDeletesPerRun must be >= 0");
  }
  if (olderThanDays !== undefined && olderThanDays < 0) {
    throw new Error("olderThanDays must be >= 0 if provided");
  }
  if (maxToKeep < minToKeep) {
    core.warning(
      `maxToKeep (${maxToKeep}) < minToKeep (${minToKeep}); using minToKeep`,
    );
    maxToKeep = minToKeep;
  }
  if (!["all", "production", "preview"].includes(environment)) {
    throw new Error(`Invalid environment '${environment}'`);
  }

  return {
    accountId,
    apiToken,
    project,
    environment,
    minToKeep,
    maxToKeep,
    olderThanDays,
    dryRun,
    maxDeletesPerRun,
    failOnError,
    emitReportArtifact,
    emitStepSummary,
  };
}
