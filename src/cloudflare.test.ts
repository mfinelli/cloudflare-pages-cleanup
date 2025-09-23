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
import {
  getEnv,
  getStr,
  getStrArray,
  hasAliases,
  isRecord,
  readBranch,
  readLatestStageStatus,
  readSourceConfigProdBranch,
} from "./cloudflare";
import type { Deployment } from "./types";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it("returns false for null and primitives", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord("hello")).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(Symbol("s"))).toBe(false);
  });

  it("returns false for arrays and common built-ins", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(new Date())).toBe(false);
    expect(isRecord(/re/)).toBe(false);
    expect(isRecord(() => {})).toBe(false);
  });

  it("returns true for class instances (object-like)", () => {
    class MyClass {
      x = 1;
    }

    expect(isRecord(new MyClass())).toBe(true);
  });
});

describe("getStr", () => {
  it("returns the string when the value is a string", () => {
    const o: Record<string, unknown> = { a: "hello" };
    expect(getStr(o, "a")).toBe("hello");
  });

  it("returns undefined for missing keys", () => {
    const o: Record<string, unknown> = { a: "hello" };
    expect(getStr(o, "b")).toBeUndefined();
  });

  it("returns undefined for non-string primitives", () => {
    const o: Record<string, unknown> = {
      n: 123,
      b: true,
      z: null,
      u: undefined,
    };

    expect(getStr(o, "n")).toBeUndefined();
    expect(getStr(o, "b")).toBeUndefined();
    expect(getStr(o, "z")).toBeUndefined();
    expect(getStr(o, "u")).toBeUndefined();
  });

  it("returns undefined for objects/arrays/functions", () => {
    const o: Record<string, unknown> = {
      obj: {},
      arr: [],
      fn: () => {},
      date: new Date(),
    };

    expect(getStr(o, "obj")).toBeUndefined();
    expect(getStr(o, "arr")).toBeUndefined();
    expect(getStr(o, "fn")).toBeUndefined();
    expect(getStr(o, "date")).toBeUndefined();
  });

  it("does not coerce String objects", () => {
    const boxed = Object("x"); // typeof boxed === "object"
    const o: Record<string, unknown> = { s: boxed as unknown };
    expect(getStr(o, "s")).toBeUndefined();
  });

  it("does not trim or normalize", () => {
    const o: Record<string, unknown> = { a: "  spaced  " };
    expect(getStr(o, "a")).toBe("  spaced  ");
  });
});

describe("getStrArray", () => {
  it("returns the array when all elements are primitive strings", () => {
    const arr = ["a", "b", "c"];
    const o: Record<string, unknown> = { aliases: arr };
    const out = getStrArray(o, "aliases");
    expect(out).toBe(arr); // same reference (no clone)
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array as-is", () => {
    const arr: string[] = [];
    const o: Record<string, unknown> = { aliases: arr };
    const out = getStrArray(o, "aliases");
    expect(out).toBe(arr);
    expect(out).toEqual([]);
  });

  it("returns undefined for missing keys", () => {
    const o: Record<string, unknown> = { other: ["x"] };
    expect(getStrArray(o, "aliases")).toBeUndefined();
  });

  it("returns undefined when any element is not a primitive string", () => {
    const cases: Record<string, unknown>[] = [
      { a: ["x", 1] },
      { a: ["x", null] },
      { a: ["x", undefined] },
      { a: ["x", {}] },
      { a: ["x", []] },
      { a: ["x", Symbol("s")] },
    ];

    for (const obj of cases) {
      expect(getStrArray(obj, "a")).toBeUndefined();
    }
  });

  it("returns undefined when value is not an array", () => {
    const o: Record<string, unknown> = {
      s: "not-an-array",
      n: 123,
      b: true,
      o: {},
      f: () => {},
      d: new Date(),
      u8: new Uint8Array([1, 2, 3]),
    };

    expect(getStrArray(o, "s")).toBeUndefined();
    expect(getStrArray(o, "n")).toBeUndefined();
    expect(getStrArray(o, "b")).toBeUndefined();
    expect(getStrArray(o, "o")).toBeUndefined();
    expect(getStrArray(o, "f")).toBeUndefined();
    expect(getStrArray(o, "d")).toBeUndefined();
    expect(getStrArray(o, "u8")).toBeUndefined();
  });

  it("rejects String object (wrapper) elements", () => {
    const boxed = Object("x"); // String wrapper; typeof boxed === "object"
    const o: Record<string, unknown> = { a: ["ok", boxed as unknown] };
    expect(getStrArray(o, "a")).toBeUndefined();
  });

  it("does not trim or coerce elements", () => {
    const o: Record<string, unknown> = { a: ["  spaced  ", "UPPER"] };
    const out = getStrArray(o, "a");
    expect(out).toEqual(["  spaced  ", "UPPER"]);
  });
});

describe("getEnv", () => {
  it("returns 'production' when the value is exactly 'production'", () => {
    const o: Record<string, unknown> = { env: "production" };
    expect(getEnv(o, "env")).toBe("production");
  });

  it("returns 'preview' when the value is exactly 'preview'", () => {
    const o: Record<string, unknown> = { env: "preview" };
    expect(getEnv(o, "env")).toBe("preview");
  });

  it("is case-sensitive and does not trim", () => {
    expect(getEnv({ env: "Production" }, "env")).toBeUndefined();
    expect(getEnv({ env: "PREVIEW" }, "env")).toBeUndefined();
    expect(getEnv({ env: " preview " }, "env")).toBeUndefined();
  });

  it("returns undefined for missing keys", () => {
    expect(getEnv({}, "env")).toBeUndefined();
  });

  it("returns undefined for non-string values", () => {
    expect(getEnv({ env: true }, "env")).toBeUndefined();
    expect(getEnv({ env: 1 }, "env")).toBeUndefined();
    expect(getEnv({ env: {} }, "env")).toBeUndefined();
    expect(getEnv({ env: [] }, "env")).toBeUndefined();

    // String wrapper object should be rejected
    const boxed = Object("production") as unknown; // typeof === "object"
    expect(getEnv({ env: boxed }, "env")).toBeUndefined();
  });

  it("returns undefined for other strings", () => {
    expect(getEnv({ env: "staging" }, "env")).toBeUndefined();
    expect(getEnv({ env: "prod" }, "env")).toBeUndefined();
    expect(getEnv({ env: "" }, "env")).toBeUndefined();
  });
});

describe("readBranch", () => {
  it("returns the branch when metadata.branch is a primitive string", () => {
    expect(readBranch({ metadata: { branch: "feat/login" } })).toBe(
      "feat/login",
    );
  });

  it("returns the string as-is (no trimming/normalization)", () => {
    expect(readBranch({ metadata: { branch: "  spaced  " } })).toBe(
      "  spaced  ",
    );
  });

  it("returns undefined when metadata is missing", () => {
    expect(readBranch({})).toBeUndefined();
  });

  it("returns undefined when metadata is not an object", () => {
    expect(
      readBranch({ metadata: "not-an-object" as unknown }),
    ).toBeUndefined();
    expect(readBranch({ metadata: 123 as unknown })).toBeUndefined();
    expect(readBranch({ metadata: null as unknown })).toBeUndefined();
    expect(readBranch({ metadata: [] as unknown })).toBeUndefined();
  });

  it("returns undefined when branch is missing", () => {
    expect(readBranch({ metadata: {} })).toBeUndefined();
  });

  it("returns undefined when branch is not a primitive string", () => {
    expect(
      readBranch({ metadata: { branch: 42 as unknown as string } }),
    ).toBeUndefined();
    expect(
      readBranch({ metadata: { branch: true as unknown as string } }),
    ).toBeUndefined();

    // wrapper string object should be rejected
    const boxed = Object("feat/wrapped") as unknown;
    expect(
      readBranch({ metadata: { branch: boxed as unknown as string } }),
    ).toBeUndefined();
  });

  it("ignores unrelated properties and still returns branch", () => {
    const obj = {
      metadata: { branch: "main", extra: 1, nested: { x: 2 } },
    } as const;
    expect(readBranch(obj as unknown as Record<string, unknown>)).toBe("main");
  });
});

describe("readLatestStageStatus", () => {
  it("returns the status string when present", () => {
    expect(readLatestStageStatus({ status: "success" })).toBe("success");
    expect(readLatestStageStatus({ status: "queued" })).toBe("queued");
  });

  it("returns the string as-is (no trimming/normalization)", () => {
    expect(readLatestStageStatus({ status: "  success  " })).toBe(
      "  success  ",
    );
    expect(readLatestStageStatus({ status: "UPPER" })).toBe("UPPER");
  });

  it("returns undefined when status is missing", () => {
    expect(readLatestStageStatus({})).toBeUndefined();
  });

  it("returns undefined for non-string values", () => {
    expect(readLatestStageStatus({ status: 123 as unknown })).toBeUndefined();
    expect(readLatestStageStatus({ status: false as unknown })).toBeUndefined();
    expect(readLatestStageStatus({ status: null as unknown })).toBeUndefined();
    expect(readLatestStageStatus({ status: {} as unknown })).toBeUndefined();
    expect(readLatestStageStatus({ status: [] as unknown })).toBeUndefined();
  });

  it("rejects String wrapper objects", () => {
    const boxed = Object("success") as unknown; // typeof === "object"
    expect(readLatestStageStatus({ status: boxed })).toBeUndefined();
  });
});

describe("readSourceConfigProdBranch", () => {
  it("reads from a config object directly", () => {
    expect(readSourceConfigProdBranch({ production_branch: "main" })).toBe(
      "main",
    );
  });

  it("reads from a source object containing config", () => {
    expect(
      readSourceConfigProdBranch({ config: { production_branch: "main" } }),
    ).toBe("main");
  });

  it("returns undefined when missing", () => {
    expect(readSourceConfigProdBranch({})).toBeUndefined();
    expect(readSourceConfigProdBranch({ config: {} })).toBeUndefined();
  });

  it("rejects non-string values", () => {
    expect(
      readSourceConfigProdBranch({ production_branch: 123 as unknown }),
    ).toBeUndefined();
    expect(
      readSourceConfigProdBranch({
        config: { production_branch: null as unknown },
      }),
    ).toBeUndefined();
  });

  it("rejects String wrapper objects", () => {
    const boxed = Object("main") as unknown; // typeof === "object"
    expect(
      readSourceConfigProdBranch({ production_branch: boxed }),
    ).toBeUndefined();
    expect(
      readSourceConfigProdBranch({ config: { production_branch: boxed } }),
    ).toBeUndefined();
  });
});

describe("hasAliases", () => {
  function dep(
    id: string,
    opts: {
      env: "production" | "preview";
      daysAgo?: number;
      aliases?: string[];
    },
  ): Deployment {
    const created_on = new Date(
      Date.now() - (opts.daysAgo ?? 0) * 24 * 60 * 60 * 1000,
    ).toISOString();
    return {
      id,
      created_on,
      environment: opts.env,
      aliases: opts.aliases,
    };
  }

  it("returns true when aliases has at least one entry", () => {
    expect(
      hasAliases(
        dep("a", { env: "preview", aliases: ["staging.example.com"] }),
      ),
    ).toBe(true);
    expect(
      hasAliases(
        dep("b", {
          env: "production",
          aliases: ["foo.pages.dev", "bar.example.com"],
        }),
      ),
    ).toBe(true);
  });

  it("returns false when aliases is an empty array", () => {
    expect(hasAliases(dep("c", { env: "preview", aliases: [] }))).toBe(false);
  });

  it("returns false when aliases is undefined", () => {
    expect(hasAliases(dep("d", { env: "production" }))).toBe(false);
  });

  it("is agnostic to environment", () => {
    expect(hasAliases(dep("e", { env: "preview", aliases: ["x"] }))).toBe(true);
    expect(hasAliases(dep("f", { env: "production", aliases: ["y"] }))).toBe(
      true,
    );
  });

  it("treats any non-empty array as true (runtime check), even if elements aren't strings", () => {
    // Cast to match the type but validate the runtime behavior of Array.isArray/length > 0
    const weird = [{}] as unknown as string[];
    expect(hasAliases(dep("g", { env: "preview", aliases: weird }))).toBe(true);
  });
});
