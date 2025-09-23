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
import { Inputs, EnvSelector } from "./types";

export function parseBool(s: string | undefined, dflt: boolean): boolean {
  if (s == null) return dflt;
  const v = String(s).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;
  return dflt;
}

export function parseIntStrict(s: string | undefined, dflt: number): number {
  if (s == null || s === "") return dflt;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Expected integer, got '${s}'`);
  }
  return n;
}

export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function daysAgoUtc(days: number): number {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return ms;
}

export function getInputs(): Inputs {
  const accountId = core
    .getInput("cloudflareAccountId", { required: true })
    .trim();
  const apiToken = core
    .getInput("cloudflareApiToken", { required: true })
    .trim();
  const project = core.getInput("project", { required: true }).trim();
  const environment = (core.getInput("environment") || "all")
    .trim()
    .toLowerCase() as EnvSelector;

  const minToKeep = parseIntStrict(core.getInput("minToKeep"), 5);
  let maxToKeep = parseIntStrict(core.getInput("maxToKeep"), 50);
  const olderThanDaysStr = core.getInput("olderThanDays");
  const olderThanDays = olderThanDaysStr
    ? parseIntStrict(olderThanDaysStr, 0)
    : undefined;

  const dryRun = parseBool(core.getInput("dryRun"), true);
  const maxDeletesPerRun = parseIntStrict(
    core.getInput("maxDeletesPerRun"),
    50,
  );
  const failOnError = parseBool(core.getInput("failOnError"), true);

  if (minToKeep < 0 || maxToKeep < 0 || maxDeletesPerRun < 0) {
    throw new Error("minToKeep, maxToKeep, maxDeletesPerRun must be ≥ 0");
  }
  if (olderThanDays !== undefined && olderThanDays < 0) {
    throw new Error("olderThanDays must be ≥ 0 if provided");
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
  };
}
