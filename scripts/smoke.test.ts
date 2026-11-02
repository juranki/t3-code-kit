// The smoke suite's pure rules. The orchestrator itself needs a real `sbx`;
// these are the parts that decide whether a version, a skill count, or a
// descriptor default is right, so they must not drift from the shell copies.
import { describe, expect, it } from "@effect/vitest";

import {
  argDefault,
  countSkills,
  markerCount,
  nonEmpty,
  parseDevices,
  positiveInt,
  readMarkerScript,
  versionOf,
  writeMarkerScript,
} from "./smoke.ts";

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

  it("parses the volume device table", () => {
    expect(parseDevices("/home/agent/workspace 64769\n/home/agent/.t3/userdata 64770\n")).toEqual({
      "/home/agent/workspace": "64769",
      "/home/agent/.t3/userdata": "64770",
    });
  });

  it("writes and reads the durability marker in every volume", () => {
    const paths = ["/home/agent/workspace", "/home/agent/.t3/userdata"];
    const write = writeMarkerScript(paths);
    expect(write).toContain("set -e");
    expect(write).toContain("> /home/agent/workspace/.smoke-marker");
    expect(write).toContain("> /home/agent/.t3/userdata/.smoke-marker");
    const read = readMarkerScript(paths);
    expect(read).toContain("cat /home/agent/workspace/.smoke-marker");
    expect(read).toContain("cat /home/agent/.t3/userdata/.smoke-marker");
    expect(markerCount("smoke-durability-marker\nsmoke-durability-marker\n")).toBe(2);
    expect(markerCount("")).toBe(0);
  });
});
