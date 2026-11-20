// Pure smoke CLI/env helpers. Browser, toolchain, and durability acceptance are
// tested through their own interfaces.
import { describe, expect, it } from "@effect/vitest";

import { dockerfileArg, nonEmpty, positiveInt } from "./smoke.ts";

describe("smoke helpers", () => {
  it("treats an empty environment value as unset", () => {
    expect(nonEmpty(undefined)).toBeUndefined();
    expect(nonEmpty("  ")).toBeUndefined();
    expect(nonEmpty(" t3ck-smoke ")).toBe("t3ck-smoke");
  });

  it("falls back on a missing or non-positive integer", () => {
    expect(positiveInt(undefined, 3773)).toBe(3773);
    expect(positiveInt("0", 3773)).toBe(3773);
    expect(positiveInt("nope", 3773)).toBe(3773);
    expect(positiveInt("40773", 3773)).toBe(40_773);
  });

  it("reads a pinned build arg out of the Dockerfile", () => {
    const text = "ARG CHROME_VERSION=156.0.8078.70\nARG TARGETARCH\n";
    expect(dockerfileArg(text, "CHROME_VERSION")).toBe("156.0.8078.70");
    expect(dockerfileArg(text, "TARGETARCH")).toBeUndefined();
  });
});
