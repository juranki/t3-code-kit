import { describe, expect, it } from "@effect/vitest";
import { VOLUME_PATHS } from "@t3ck/kit/Volumes";
import type { ExecResult } from "@t3ck/sbx/Sbx";
import { make as makeFakeSbx, type FakeRule } from "@t3ck/sbx/fake";
import * as Effect from "effect/Effect";

import { checkDurability, type CliRunner } from "./durability-acceptance.ts";

const SANDBOX = "durability-check";

const listing = (present: boolean): string =>
  JSON.stringify(
    present
      ? [
          {
            name: SANDBOX,
            agent: "kit",
            status: "running",
            ports: [],
            created_at: "2026-11-20T00:00:00Z",
          },
        ]
      : [],
  );

const deviceOutput = (devices: ReadonlyArray<string>): string =>
  VOLUME_PATHS.map((volumePath, index) => `${volumePath} ${devices[index] ?? "100"}`).join("\n");

const okExec = (stdout = ""): ExecResult => ({ stdout, stderr: "", exitCode: 0 });
const failExec = (exitCode = 1, stderr = "failed"): ExecResult => ({
  stdout: "",
  stderr,
  exitCode,
});

const scriptOf = (command: { readonly args: ReadonlyArray<string> }): string => {
  const index = command.args.indexOf("-c");
  return index >= 0 ? (command.args[index + 1] ?? "") : "";
};

const isVerb = (command: { readonly args: ReadonlyArray<string> }, verb: string): boolean =>
  (command.args[0] === "--no-input" ? command.args[1] : command.args[0]) === verb;

const rebuildMarkerRead = [
  "present /home/agent/.t3/userdata",
  "present /home/agent/workspace",
].join("\n");

const nukeMarkerClean = VOLUME_PATHS.map((volumePath) => `missing ${volumePath}`).join("\n");

interface CliCall {
  readonly args: ReadonlyArray<string>;
  readonly timeoutMs: number;
}

const makeScriptedCli = (
  responses: ReadonlyArray<Effect.Effect<ExecResult, { readonly message: string }>>,
): { readonly calls: Array<CliCall>; readonly runCli: CliRunner } => {
  const calls: Array<CliCall> = [];
  let index = 0;
  const runCli: CliRunner = (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    const next = responses[index++];
    return next ?? Effect.succeed(okExec());
  };
  return { calls, runCli };
};

const healthyCliResponses = (): ReadonlyArray<
  Effect.Effect<ExecResult, { readonly message: string }>
> => [
  Effect.succeed(okExec()), // rebuild
  Effect.succeed(failExec(2, "refusing without --yes")), // nuke without --yes
  Effect.succeed(okExec()), // nuke --yes
  Effect.succeed(okExec()), // up after nuke
  Effect.succeed(okExec()), // final nuke --yes
  Effect.succeed(failExec(1, "no sandbox")), // nuke on missing instance
];

const healthySbxRules = (
  overrides: {
    readonly existsAfterRebuild?: boolean;
    readonly existsAfterRefusal?: boolean;
    readonly existsBeforeFinalNuke?: boolean;
    readonly rebuildReadStdout?: string;
    readonly nukeReadStdout?: string;
    readonly workspaceStdout?: string;
    readonly devicesBefore?: ReadonlyArray<string>;
    readonly devicesAfter?: ReadonlyArray<string>;
  } = {},
): ReadonlyArray<FakeRule> => {
  const lsResponses = [
    overrides.existsAfterRebuild ?? true,
    overrides.existsAfterRefusal ?? true,
    overrides.existsBeforeFinalNuke ?? true,
  ];
  let lsIndex = 0;

  const readResponses = [
    overrides.rebuildReadStdout ?? rebuildMarkerRead,
    overrides.nukeReadStdout ?? nukeMarkerClean,
  ];
  let readIndex = 0;

  const deviceResponses = [
    deviceOutput(overrides.devicesBefore ?? ["64769", "64770", "64771", "64772"]),
    deviceOutput(overrides.devicesAfter ?? ["64769", "64770", "64771", "64772"]),
  ];
  let deviceIndex = 0;

  return [
    {
      match: (command) => isVerb(command, "ls"),
      response: {
        get stdout() {
          return listing(lsResponses[lsIndex++] ?? false);
        },
      },
    },
    {
      match: (command) => scriptOf(command).includes("stat -c '%d'"),
      response: {
        get stdout() {
          return deviceResponses[deviceIndex++] ?? "";
        },
      },
    },
    {
      match: (command) => scriptOf(command).includes("printf 'present %s\\n'"),
      response: {
        get stdout() {
          return readResponses[readIndex++] ?? "";
        },
      },
    },
    {
      match: (command) => scriptOf(command).includes("find /home/agent/workspace"),
      response: { stdout: overrides.workspaceStdout ?? "" },
    },
  ];
};

describe("durability acceptance", () => {
  it.effect("passes all ADR 0003 checks, flushes markers with sync, and leaves state nuked", () => {
    const fake = makeFakeSbx({ rules: healthySbxRules() });
    const cli = makeScriptedCli(healthyCliResponses());

    return Effect.gen(function* () {
      const result = yield* checkDurability({
        name: SANDBOX,
        upTimeoutMs: 300_000,
        nukeTimeoutMs: 200_000,
        execTimeoutMs: 60_000,
        runCli: cli.runCli,
      });

      expect(result.state).toBe("nuked");
      expect(result.checks).toEqual([
        { status: "pass", label: "rebuild kept the marker in .t3/userdata and workspace" },
        { status: "pass", label: "nuke without --yes on a non-TTY refused and removed nothing" },
        { status: "pass", label: "nuke wiped the volumes and removed the instance" },
        { status: "pass", label: "nuke left no marker in any of the four volumes" },
        { status: "pass", label: "workspace has no entries after nuke + up" },
        { status: "pass", label: "the four volume objects are the same (still allocated)" },
        { status: "pass", label: "nuke removed the recreated instance" },
        { status: "pass", label: "nuke on a missing instance exits non-zero" },
      ]);

      expect(cli.calls).toEqual([
        { args: ["rebuild", SANDBOX], timeoutMs: 300_000 },
        { args: ["nuke", SANDBOX], timeoutMs: 200_000 },
        { args: ["nuke", SANDBOX, "--yes"], timeoutMs: 200_000 },
        { args: ["up", SANDBOX], timeoutMs: 300_000 },
        { args: ["nuke", SANDBOX, "--yes"], timeoutMs: 200_000 },
        { args: ["nuke", SANDBOX, "--yes"], timeoutMs: 200_000 },
      ]);

      // Every marker write flushes to disk before destroying the instance.
      const markerWrites = fake.commands
        .map(scriptOf)
        .filter((script) => script.includes("smoke-durability-marker"));
      expect(markerWrites).toHaveLength(2);
      for (const script of markerWrites) {
        expect(script).toContain("set -e");
        expect(script.trimEnd().endsWith("sync")).toBe(true);
      }

      // Workspace check avoids descending into root-owned lost+found.
      const findScript = fake.commands
        .map(scriptOf)
        .find((script) => script.includes("find /home/agent/workspace"));
      expect(findScript).toContain("-maxdepth 1");
      expect(findScript).toContain("! -name '.sbx-volume-initialized'");
      expect(findScript).toContain("! -name 'lost+found'");
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("bails out with state gone when rebuild fails and the sandbox disappears", () => {
    const fake = makeFakeSbx({ rules: healthySbxRules({ existsAfterRebuild: false }) });
    const rebuildFailure = failExec(1, "build error");
    const cli = makeScriptedCli([Effect.succeed(rebuildFailure)]);

    return Effect.gen(function* () {
      const result = yield* checkDurability({
        name: SANDBOX,
        upTimeoutMs: 300_000,
        nukeTimeoutMs: 200_000,
        execTimeoutMs: 60_000,
        runCli: cli.runCli,
      });

      expect(result.state).toBe("gone");
      expect(result.checks).toEqual([
        { status: "fail", label: "rebuild failed (exit 1)", output: rebuildFailure },
        { status: "fail", label: "sandbox is gone after rebuild; skipping the nuke checks" },
      ]);
      expect(cli.calls).toHaveLength(1);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("names the volume when rebuild loses durable state", () => {
    const fake = makeFakeSbx({
      rules: healthySbxRules({
        rebuildReadStdout: "present /home/agent/.t3/userdata\nmissing /home/agent/workspace\n",
      }),
    });
    const cli = makeScriptedCli(healthyCliResponses());

    return Effect.gen(function* () {
      const result = yield* checkDurability({
        name: SANDBOX,
        upTimeoutMs: 300_000,
        nukeTimeoutMs: 200_000,
        execTimeoutMs: 60_000,
        runCli: cli.runCli,
      });

      expect(result.checks[0]).toEqual({
        status: "fail",
        label: "rebuild lost the marker in /home/agent/workspace: durable state did not survive",
      });
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("fails when nuke without --yes succeeds or removes the sandbox", () => {
    const fake = makeFakeSbx({ rules: healthySbxRules() });
    const responses = [...healthyCliResponses()];
    responses[1] = Effect.succeed(okExec());
    const cli = makeScriptedCli(responses);

    return Effect.gen(function* () {
      const result = yield* checkDurability({
        name: SANDBOX,
        upTimeoutMs: 300_000,
        nukeTimeoutMs: 200_000,
        execTimeoutMs: 60_000,
        runCli: cli.runCli,
      });

      expect(result.checks[1]).toEqual({
        status: "fail",
        label: "nuke without --yes did not refuse (exit 0)",
      });
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect(
    "reports surviving markers, leftover workspace entries, and lost volume retention",
    () => {
      const fake = makeFakeSbx({
        rules: healthySbxRules({
          nukeReadStdout: [
            "present /home/agent/workspace",
            "missing /home/agent/.t3/userdata",
            "missing /home/agent/.t3/projects",
            "missing /home/agent/.t3/worktrees",
          ].join("\n"),
          workspaceStdout: "/home/agent/workspace/leaked-repo\n",
          devicesBefore: ["64769", "64770", "64771", "64772"],
          devicesAfter: ["64769", "99999", "64771", "64772"],
        }),
      });
      const cli = makeScriptedCli(healthyCliResponses());

      return Effect.gen(function* () {
        const result = yield* checkDurability({
          name: SANDBOX,
          upTimeoutMs: 300_000,
          nukeTimeoutMs: 200_000,
          execTimeoutMs: 60_000,
          runCli: cli.runCli,
        });

        expect(result.checks[3]).toEqual({
          status: "fail",
          label:
            "a marker survived nuke in /home/agent/workspace: the wipe did not destroy the data",
        });
        expect(result.checks[4]).toEqual({
          status: "fail",
          label: "workspace is not empty after nuke + up: /home/agent/workspace/leaked-repo",
        });
        expect(result.checks[5]).toEqual({
          status: "fail",
          label: "the volumes changed after nuke: retention did not hold",
        });
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect("fails when nuke on a missing instance succeeds", () => {
    const fake = makeFakeSbx({ rules: healthySbxRules() });
    const responses = [...healthyCliResponses()];
    responses[5] = Effect.succeed(okExec());
    const cli = makeScriptedCli(responses);

    return Effect.gen(function* () {
      const result = yield* checkDurability({
        name: SANDBOX,
        upTimeoutMs: 300_000,
        nukeTimeoutMs: 200_000,
        execTimeoutMs: 60_000,
        runCli: cli.runCli,
      });

      expect(result.checks.at(-1)).toEqual({
        status: "fail",
        label: "nuke on a missing instance succeeded",
      });
    }).pipe(Effect.provide(fake.layer));
  });
});
