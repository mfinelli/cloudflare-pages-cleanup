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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { errorMessage, daysAgoUtc, parseBool, parseIntStrict } from "./utils";

describe("errorMessage", () => {
  it("returns .message for Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns .message for Error subclasses", () => {
    class CustomErr extends Error {}
    expect(errorMessage(new CustomErr("kapow"))).toBe("kapow");
  });

  it("string -> same string", () => {
    expect(errorMessage("oops")).toBe("oops");
  });

  it("number -> stringified", () => {
    expect(errorMessage(42)).toBe("42");
  });

  it("boolean -> stringified", () => {
    expect(errorMessage(false)).toBe("false");
  });

  it("null -> 'null'", () => {
    expect(errorMessage(null)).toBe("null");
  });

  it("undefined -> 'undefined'", () => {
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("plain object -> default toString", () => {
    expect(errorMessage({})).toBe("[object Object]");
  });

  it("object with custom toString() -> uses it", () => {
    const obj = { toString: () => "custom-to-string" };
    expect(errorMessage(obj)).toBe("custom-to-string");
  });

  it("symbol -> stringified", () => {
    expect(errorMessage(Symbol("x"))).toBe("Symbol(x)");
  });

  it("Error without message -> empty string", () => {
    const e = new Error();
    // Node sets empty message by default
    expect(errorMessage(e)).toBe("");
  });
});

describe("parseBool", () => {
  it("returns the default when input is undefined", () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool(undefined, false)).toBe(false);
  });

  it("treats common true-ish strings as true (case/space insensitive)", () => {
    const truths = [
      "true",
      "TRUE",
      "TrUe",
      "  true  ",
      "1",
      "yes",
      "YeS",
      " y ",
    ];
    for (const v of truths) {
      expect(parseBool(v, false)).toBe(true);
    }
  });

  it("treats common false-ish strings as false (case/space insensitive)", () => {
    const falses = [
      "false",
      "FALSE",
      "FaLsE",
      "  false  ",
      "0",
      "no",
      "No",
      " n ",
    ];
    for (const v of falses) {
      expect(parseBool(v, true)).toBe(false);
    }
  });

  it("returns default for empty or whitespace-only strings", () => {
    expect(parseBool("", true)).toBe(true);
    expect(parseBool("   ", false)).toBe(false);
  });

  it("returns default for unknown strings", () => {
    expect(parseBool("maybe", true)).toBe(true);
    expect(parseBool("on", false)).toBe(false); // not recognized → default
  });

  it("handles newline/trim edge cases", () => {
    expect(parseBool("true\n", false)).toBe(true);
    expect(parseBool("\tNO\r", true)).toBe(false);
  });

  // (Optional) If you want to assert runtime resilience to non-string inputs:
  // Casts simulate JS callers passing unexpected types
  it("gracefully stringifies unexpected types and still applies defaults", () => {
    expect(parseBool(null as unknown as string, true)).toBe(true);
    expect(parseBool(42 as unknown as string, false)).toBe(false); // "42" not recognized → default
    expect(parseBool(false as unknown as string, true)).toBe(true); // "false" only if actual string
  });
});

describe("parseIntStrict", () => {
  it("returns default when input is undefined", () => {
    expect(parseIntStrict(undefined, 5)).toBe(5);
  });

  it("returns default when input is empty string", () => {
    expect(parseIntStrict("", 7)).toBe(7);
  });

  it("returns default for whitespace-only strings", () => {
    expect(parseIntStrict("   ", 9)).toBe(9);
    expect(parseIntStrict("\n\t  ", 3)).toBe(3);
  });

  it("parses positive and negative integers", () => {
    expect(parseIntStrict("42", 0)).toBe(42);
    expect(parseIntStrict("-7", 0)).toBe(-7);
    expect(parseIntStrict("003", 0)).toBe(3);
  });

  it("accepts scientific and hex forms per Number() semantics", () => {
    expect(parseIntStrict("1e3", 0)).toBe(1000);
    expect(parseIntStrict("0x10", 0)).toBe(16);
  });

  it("accepts integer-like decimals that coerce to an integer", () => {
    expect(parseIntStrict("1.0", 0)).toBe(1);
  });

  it("throws for non-integer numeric strings", () => {
    expect(() => parseIntStrict("3.14", 0)).toThrow(
      /Expected integer, got '3\.14'/,
    );
  });

  it("throws for NaN/Infinity", () => {
    expect(() => parseIntStrict("NaN", 0)).toThrow(/Expected integer/);
    expect(() => parseIntStrict("Infinity", 0)).toThrow(/Expected integer/);
    expect(() => parseIntStrict("-Infinity", 0)).toThrow(/Expected integer/);
  });

  it("throws for non-numeric strings", () => {
    expect(() => parseIntStrict("abc", 0)).toThrow(
      /Expected integer, got 'abc'/,
    );
  });

  it("handles very large integers within JS number limits", () => {
    expect(parseIntStrict("9007199254740991", 0)).toBe(9007199254740991);
  });
});

describe("daysAgoUtc", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Pick a fixed UTC anchor to avoid any confusion with local time
  const ANCHOR = new Date("2025-01-15T12:34:56.789Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns current epoch ms for 0 days", () => {
    expect(daysAgoUtc(0)).toBe(ANCHOR.getTime());
  });

  it("subtracts exactly one day", () => {
    expect(daysAgoUtc(1)).toBe(ANCHOR.getTime() - DAY_MS);
  });

  it("subtracts multiple days", () => {
    expect(daysAgoUtc(30)).toBe(ANCHOR.getTime() - 30 * DAY_MS);
  });

  it("supports fractional days", () => {
    expect(daysAgoUtc(1.5)).toBe(ANCHOR.getTime() - 1.5 * DAY_MS);
  });

  it("is monotonic with increasing days", () => {
    const d0 = daysAgoUtc(0);
    const d1 = daysAgoUtc(1);
    const d2 = daysAgoUtc(2);
    expect(d2).toBeLessThan(d1);
    expect(d1).toBeLessThan(d0);
  });

  // Optional: document behavior for negatives (we validate inputs elsewhere)
  it("returns a future timestamp for negative days", () => {
    expect(daysAgoUtc(-2)).toBe(ANCHOR.getTime() + 2 * DAY_MS);
  });
});
