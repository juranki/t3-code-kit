// The smoke suite's pure rules. The orchestrator itself needs a real `sbx`;
// these are the parts that decide whether a version, a skill count, or a
// descriptor default is right, so they must not drift from the shell copies.
import { describe, expect, it } from "@effect/vitest";

import { argDefault, countSkills, nonEmpty, positiveInt, versionOf } from "./smoke.ts";

describe("smoke helpers", () => {
  it("reads a descriptor build-arg default", () => {
    expect(argDefault('nodeVersion:\n    default: "26.13.0"\n', "nodeVersion")).toBe("26.13.0");
    expect(argDefault('nodeVersion:\n    default: "26.13.0"\n', "goVersion")).toBeUndefined();
  });

  it("counts the skills manifest the way kit/skills.sh does", () => {
    expect(countSkills("# comment\n\nalpha\nbeta\n")).toBe(2);
    expect(countSkills("")).toBe(0);
  });

  it("normalizes the toolchain version strings", () => {
    expect(versionOf("node", "v26.13.0\n")).toBe("26.13.0");
    expect(versionOf("go", "go version go1.25.14 linux/amd64\n")).toBe("1.25.14");
    expect(versionOf("python", "Python 3.13.18\n")).toBe("3.13.18");
  });

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
});
