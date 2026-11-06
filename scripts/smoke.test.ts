// The smoke suite's pure rules. The orchestrator itself needs a real `sbx`;
// these are the parts that decide whether a version, a skill count, or a
// descriptor default is right, so they must not drift from the shell copies.
import { describe, expect, it } from "@effect/vitest";

import {
  argDefault,
  browserProbeScript,
  chromePlatformOf,
  chromeVersionOf,
  glyphRatio,
  countSkills,
  dockerfileArg,
  markerCount,
  markerPaths,
  nonEmpty,
  parseBrowserProbe,
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

  it("writes, flushes, and reads the durability marker in every volume", () => {
    const paths = ["/home/agent/workspace", "/home/agent/.t3/userdata"];
    const write = writeMarkerScript(paths);
    expect(write).toContain("set -e");
    expect(write).toContain("> /home/agent/workspace/.smoke-marker");
    expect(write).toContain("> /home/agent/.t3/userdata/.smoke-marker");
    // The marker has to be on disk before the instance is destroyed, or the
    // check measures write-back timing instead of retention.
    expect(write.trimEnd().endsWith("sync")).toBe(true);
    const read = readMarkerScript(paths);
    expect(read).toContain("[ -f /home/agent/workspace/.smoke-marker ]");
    expect(read).toContain("[ -f /home/agent/.t3/userdata/.smoke-marker ]");
    expect(read).toContain("printf 'present %s\\n' /home/agent/workspace");
    expect(read).toContain("printf 'missing %s\\n' /home/agent/.t3/userdata");
    const output = "present /a\nmissing /b\npresent /c\n";
    expect(markerCount(output)).toBe(2);
    expect(markerPaths(output, "present")).toEqual(["/a", "/c"]);
    expect(markerPaths(output, "missing")).toEqual(["/b"]);
    expect(markerCount("")).toBe(0);
  });

  it("reads a pinned build arg out of the Dockerfile", () => {
    const text = "ARG CHROME_VERSION=156.0.8078.70\nARG TARGETARCH\n";
    expect(dockerfileArg(text, "CHROME_VERSION")).toBe("156.0.8078.70");
    expect(dockerfileArg(text, "TARGETARCH")).toBeUndefined();
  });

  it("normalizes the preview browser's version line", () => {
    expect(chromeVersionOf("Google Chrome for Testing 156.0.8078.70\n")).toBe("156.0.8078.70");
    expect(chromeVersionOf("")).toBe("");
  });

  it("measures whether glyphs are proportional or tofu boxes", () => {
    // The real measurement from a sandbox: 8 x "I" and 8 x "W" at 40px.
    expect(glyphRatio("88.90625,302.03125")).toBeCloseTo(3.4, 1);
    // Tofu renders every character at the same advance width.
    expect(glyphRatio("100,100")).toBe(1);
    expect(glyphRatio("")).toBeUndefined();
    expect(glyphRatio("nonsense")).toBeUndefined();
  });

  it("names the chrome-for-testing platform directory t3 looks in", () => {
    expect(chromePlatformOf("x86_64")).toBe("linux64");
    expect(chromePlatformOf("aarch64")).toBe("linux-arm64");
    expect(chromePlatformOf("riscv64")).toBeUndefined();
  });

  it("parses the browser probe", () => {
    const stdout = [
      "bin=/home/agent/.t3/tools/chrome-headless-shell/linux64/156.0.8078.70/chrome-headless-shell",
      "machine=x86_64",
      "missing=0",
      "version=Google Chrome for Testing 156.0.8078.70",
      "font=/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
      "glyphs=88.90625,302.03125",
      "tls=ok",
    ].join("\n");
    expect(parseBrowserProbe(stdout)).toEqual({
      bin: "/home/agent/.t3/tools/chrome-headless-shell/linux64/156.0.8078.70/chrome-headless-shell",
      machine: "x86_64",
      missing: 0,
      version: "Google Chrome for Testing 156.0.8078.70",
      font: "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
      glyphs: "88.90625,302.03125",
      tls: "ok",
    });

    // No binary: the image did not pre-seed it, so there is nothing to measure.
    expect(parseBrowserProbe("bin=\nfont=")).toEqual({
      bin: undefined,
      machine: undefined,
      missing: undefined,
      version: undefined,
      font: undefined,
      glyphs: undefined,
      tls: undefined,
    });

    expect(parseBrowserProbe("bin=/x\nmissing=3\n").missing).toBe(3);
  });

  it("probes the browser the way t3 launches it", () => {
    const script = browserProbeScript();
    expect(script).toContain(
      "/home/agent/.t3/tools/chrome-headless-shell/*/*/chrome-headless-shell",
    );
    expect(script).toContain("uname -m");
    expect(script).toContain('grep -c "not found"');
    expect(script).toContain("--version");
    expect(script).toContain("fc-match");
    expect(script).toContain("WWWWWWWW");
    expect(script).toContain("https://github.com");
  });
});
