import { describe, expect, it } from "@effect/vitest";
import { make as makeFakeSbx, type FakeResponse, type FakeRule } from "@t3ck/sbx/fake";
import * as Effect from "effect/Effect";

import { checkToolchain, type ToolchainCheckResult } from "./toolchain-acceptance.ts";

const DESCRIPTOR = `
args:
  nodeVersion:
    default: "26.13.1"
  goVersion:
    default: "1.25.14"
  pythonVersion:
    default: "3.13.18"
  vitePlusVersion:
    default: "1.6.0"
  fdVersion:
    default: "10.4.2"
  codexVersion:
    default: "0.122.0"
  claudeCodeVersion:
    default: "2.1.114"
`;

const SKILLS_MANIFEST = "# baked skills\n\nalpha\nbeta\n";

const scriptOf = (command: { readonly args: ReadonlyArray<string> }): string => {
  const index = command.args.indexOf("-c");
  return index >= 0 ? (command.args[index + 1] ?? "") : "";
};

const healthyShimOutput = [
  "node=v26.13.1",
  "go=go version go1.25.14 linux/amd64",
  "python=Python 3.13.18",
  "node_path=/home/agent/.local/share/mise/shims/node",
  "go_path=/home/agent/.local/share/mise/shims/go",
  "python_path=/home/agent/.local/share/mise/shims/python",
].join("\n");

const healthyRules = (overrides: Readonly<Record<string, FakeResponse>> = {}): FakeRule[] => {
  const table: ReadonlyArray<readonly [string, FakeResponse]> = [
    ["t3 --version", { stdout: "0.1.9\n" }],
    ["pi --version", { stdout: "0.5.0\n" }],
    ["git --version", { stdout: "git version 2.47.0\n" }],
    ["mise --version", { stdout: "2026.10.0\n" }],
    ["od -An -c", { stdout: " 303 244\n" }],
    ["$LC_ALL", { stdout: "C.UTF-8" }],
    ["node_path=", { stdout: healthyShimOutput }],
    ["vp --version", { stdout: "vp v1.6.0\n" }],
    ["fd --version", { stdout: "fd 10.4.2\n" }],
    ["codex --version", { stdout: "codex-cli 0.122.0\n" }],
    ["claude --version", { stdout: "2.1.114 (Claude Code)\n" }],
    ["java -version", { stderr: 'openjdk version "21.0.8" 2026-07-15\n' }],
    ["dpkg --audit", { stdout: "audit=\n" }],
    ["mountpoint -q", { stdout: "" }],
    ["t3 serve", { stdout: "/bin/bash\n" }],
    ["skills=", { stdout: "skills=2\n" }],
  ];
  return table.map(([needle, defaultResponse]) => ({
    match: (command) => scriptOf(command).includes(needle),
    response: overrides[needle] ?? defaultResponse,
  }));
};

const healthyResults: ReadonlyArray<ToolchainCheckResult> = [
  "t3 --version",
  "pi --version",
  "git --version",
  "mise --version",
  "non-ASCII bytes survive a round-trip",
  "sandbox locale is UTF-8",
  "node 26.13.1 through the mise shim",
  "go 1.25.14 through the mise shim",
  "python 3.13.18 through the mise shim",
  "vp 1.6.0 is the baked version",
  "fd 10.4.2 is the baked version",
  "codex 0.122.0 is the baked version",
  "claude 2.1.114 is the baked version",
  "java -version is the base image's OpenJDK 21",
  "dpkg --audit is clean",
  "/home/agent/workspace is a volume mount, not a host mount",
  "t3 serve runs with SHELL=/bin/bash (the terminal has history and completion)",
  "2 skills baked in, kit/skills.txt agrees",
].map((label) => ({ status: "pass", label }));

describe("toolchain acceptance", () => {
  it.effect("passes all 18 checks using bounded non-interactive exec calls", () => {
    const fake = makeFakeSbx({ rules: healthyRules() });
    return Effect.gen(function* () {
      const results = yield* checkToolchain({
        name: "toolchain-check",
        descriptor: DESCRIPTOR,
        skillsManifest: SKILLS_MANIFEST,
        timeoutMs: 12_345,
      });
      expect(results).toEqual(healthyResults);
      expect(fake.commands).toHaveLength(16);
      for (const command of fake.commands) {
        expect(command.args.slice(0, 6)).toEqual([
          "--no-input",
          "exec",
          "toolchain-check",
          "--",
          "sh",
          "-c",
        ]);
        expect(command.timeoutMs).toBe(12_345);
        expect(command.tty).toBe(false);
      }
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect.each([
    {
      scenario: "missing core binary",
      overrides: { "pi --version": { exitCode: 127, stderr: "sh: 1: pi: not found\n" } },
      index: 1,
      label: "pi --version: exit 127 (sh: 1: pi: not found)",
    },
    {
      scenario: "broken UTF-8 round-trip",
      overrides: { "od -An -c": { stdout: " 077\n" } },
      index: 4,
      label: "non-ASCII bytes do not survive a round-trip",
    },
    {
      scenario: "non-UTF-8 locale",
      overrides: { $LC_ALL: { stdout: "POSIX" } },
      index: 5,
      label: "sandbox locale is not UTF-8 (LC_ALL is not set to a UTF-8 locale)",
    },
    {
      scenario: "node bypassing mise shim",
      overrides: {
        "node_path=": {
          stdout: healthyShimOutput.replace(
            "/home/agent/.local/share/mise/shims/node",
            "/usr/bin/node",
          ),
        },
      },
      index: 6,
      label:
        "node resolves to /usr/bin/node, not the mise shim (/home/agent/.local/share/mise/shims/node)",
    },
    {
      scenario: "wrong go version",
      overrides: {
        "node_path=": {
          stdout: healthyShimOutput.replace("go1.25.14", "go1.24.0"),
        },
      },
      index: 7,
      label: "go reports 1.24.0, want 1.25.14 (the baked version)",
    },
    {
      scenario: "wrong baked claude version",
      overrides: { "claude --version": { stdout: "2.0.0 (Claude Code)\n" } },
      index: 12,
      label: "claude reports 2.0.0, want 2.1.114 (the baked version)",
    },
    {
      scenario: "wrong OpenJDK version",
      overrides: { "java -version": { stderr: 'openjdk version "17.0.1"\n' } },
      index: 13,
      label: 'java -version is not OpenJDK 21: openjdk version "17.0.1"',
    },
    {
      scenario: "unconfigured dpkg packages",
      overrides: { "dpkg --audit": { stdout: "audit=ca-certificates-bundle\n" } },
      index: 14,
      label: "dpkg --audit reports unconfigured packages: ca-certificates-bundle",
    },
    {
      scenario: "workspace not mounted as a volume",
      overrides: { "mountpoint -q": { exitCode: 1 } },
      index: 15,
      label: "/home/agent/workspace is not a volume mount",
    },
    {
      scenario: "t3 serve falling back to dash",
      overrides: { "t3 serve": { stdout: "/bin/sh\n" } },
      index: 16,
      label: "t3 serve has SHELL=/bin/sh: the UI terminal falls back to dash",
    },
    {
      scenario: "mismatched baked skill count",
      overrides: { "skills=": { stdout: "skills=1\n" } },
      index: 17,
      label: "skills: 1 baked in, 2 in kit/skills.txt",
    },
  ])("reports $scenario without skipping later checks", ({ overrides, index, label }) => {
    const fake = makeFakeSbx({ rules: healthyRules(overrides) });
    return Effect.gen(function* () {
      const results = yield* checkToolchain({
        name: "toolchain-check",
        descriptor: DESCRIPTOR,
        skillsManifest: SKILLS_MANIFEST,
        timeoutMs: 60_000,
      });
      expect(results).toEqual(
        healthyResults.map((result, current) =>
          current === index ? { status: "fail", label } : result,
        ),
      );
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("reports a single failure when the mise shim probe times out", () => {
    const fake = makeFakeSbx({
      rules: healthyRules({ "node_path=": { fail: "timeout" } }),
    });
    return Effect.gen(function* () {
      const results = yield* checkToolchain({
        name: "toolchain-check",
        descriptor: DESCRIPTOR,
        skillsManifest: SKILLS_MANIFEST,
        timeoutMs: 5_000,
      });
      expect(results[6]).toEqual({
        status: "fail",
        label: "could not read the mise shims: sbx exec toolchain-check timed out after 5000ms.",
      });
      expect(results).toHaveLength(16);
    }).pipe(Effect.provide(fake.layer));
  });
});
