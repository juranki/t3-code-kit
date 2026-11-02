// The v2 parity guardrail for the verbs the v2 CLI ports. It runs the same
// cases as the launcher characterization suite, but against
// `apps/cli/src/bin.ts`. `rebuild` is unchanged from the launchers; `nuke` is
// different by design (ADR 0003), so its v2 cases are asserted separately.
//
// It is skipped on Windows, where the fake `sbx` is a PowerShell shim and the
// v2 seam spawns `$SBX` directly. The production binary is a real `sbx.exe`;
// the Windows proof is the real smoke suite, not a shim.
import { describe, expect, it } from "@effect/vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  CASES,
  type Golden,
  launcherAvailable,
  makeFixtures,
  runCase,
  sandboxTable,
  type Rule,
  type Scenario,
  slug,
  withServer,
} from "./characterization/harness.ts";

const goldenDir = join(import.meta.dirname, "characterization", "golden");

// The old launchers' nuke cases pin the pre-#38 volume-removal argv. v2 nuke
// is different by design (ADR 0003), so those cases are excluded here and the
// v2 cases below assert the new sequence. `rebuild` is unchanged and stays in
// the shared table.
const OLD_NUKE = new Set([
  "nuke",
  "nuke rm fails",
  "nuke volume unsupported",
  "nuke volume rm fails",
  "nuke no matching volume",
]);

// Where v2 deliberately follows `sh` rather than the ps1 reference.
const V2_OVERRIDES: Record<string, Pick<Golden, "exit" | "calls" | "warnings">> = {
  "help flag": { exit: 0, calls: [], warnings: [] },
  "unknown verb": {
    exit: 1,
    calls: [],
    warnings: ["unknown verb 'bogus' (try: t3-code-kit --help)"],
  },
};

const cases = CASES.filter((testCase) => !OLD_NUKE.has(testCase.name));

interface V2NukeCase {
  readonly name: string;
  readonly args: ReadonlyArray<string>;
  readonly scenario: Scenario;
  readonly exit: number;
  readonly calls: ReadonlyArray<ReadonlyArray<string>>;
  readonly warnings: ReadonlyArray<string>;
  readonly stdout?: ReadonlyArray<string>;
}

const nukeList = (name: string): Rule => ({ match: ["ls"], stdout: sandboxTable(name) });

// The marker, wipe, and verify are all `exec … sh -c <script>`; only the
// script tells them apart, so the rules match on a substring of the one script
// argv.
const nukeMarker: Rule = {
  match: ["exec", "*", "--", "sh", "-c"],
  contains: [".t3ck-nuke-marker", ">"],
  stdout: "",
};

const nukeWipe: Rule = {
  match: ["exec", "*", "--", "sh", "-c"],
  contains: ["-mindepth 1 -delete"],
  stdout: "",
};

const nukeVerify = (survivors = ""): Rule => ({
  match: ["exec", "*", "--", "sh", "-c"],
  contains: ["[ ! -e"],
  stdout: survivors,
});

const nukeRm = (response: { readonly exit?: number; readonly stderr?: string } = {}): Rule => ({
  match: ["rm", "--force", "*"],
  ...response,
});

const markerCall = ["exec", "<name>", "--", "sh", "-c", "<marker>"];
const wipeCall = ["exec", "<name>", "--", "sh", "-c", "<wipe>"];
const verifyCall = ["exec", "<name>", "--", "sh", "-c", "<verify>"];
const missingRemedy =
  "no sandbox named '<name>': its volume contents may still be on disk. run 't3-code-kit up <name>', then 't3-code-kit nuke <name>'";

const V2_NUKE_CASES: ReadonlyArray<V2NukeCase> = [
  {
    name: "nuke --yes",
    args: ["nuke", "charprobe", "--yes"],
    scenario: {
      calls: [nukeList("charprobe"), nukeMarker, nukeWipe, nukeVerify(), nukeRm()],
    },
    exit: 0,
    calls: [["ls"], markerCall, wipeCall, verifyCall, ["rm", "--force", "<name>"]],
    warnings: [],
    stdout: ["done."],
  },
  {
    name: "nuke without --yes on a non-TTY",
    args: ["nuke", "charprobe"],
    scenario: { calls: [nukeList("charprobe")] },
    exit: 2,
    calls: [["ls"]],
    warnings: ["refusing to nuke '<name>' without --yes on a non-TTY"],
  },
  {
    name: "nuke on a missing instance",
    args: ["nuke", "charprobe", "--yes"],
    scenario: { calls: [nukeList("other")] },
    exit: 1,
    calls: [["ls"]],
    warnings: [missingRemedy],
  },
  {
    name: "nuke aborts when the wipe fails twice",
    args: ["nuke", "charprobe", "--yes"],
    scenario: {
      calls: [
        nukeList("charprobe"),
        nukeMarker,
        nukeWipe,
        nukeVerify("/home/agent/workspace/.t3ck-nuke-marker\n"),
      ],
    },
    exit: 1,
    calls: [["ls"], markerCall, wipeCall, verifyCall, markerCall, wipeCall, verifyCall],
    warnings: [
      "wipe of '<name>' left data behind; retrying once",
      "could not wipe '<name>'; the sandbox was not removed (its data is still there)",
    ],
  },
  {
    name: "nuke fails when rm says the instance is missing",
    args: ["nuke", "charprobe", "--yes"],
    scenario: {
      calls: [
        nukeList("charprobe"),
        nukeMarker,
        nukeWipe,
        nukeVerify(),
        nukeRm({ exit: 1, stderr: "error: sandbox 'charprobe' not found\n" }),
      ],
    },
    exit: 1,
    calls: [["ls"], markerCall, wipeCall, verifyCall, ["rm", "--force", "<name>"]],
    warnings: [missingRemedy],
  },
];

const normalizeScripts = (calls: ReadonlyArray<ReadonlyArray<string>>): string[][] =>
  calls.map((call) =>
    call.map((arg) =>
      arg.includes("-mindepth 1 -delete")
        ? "<wipe>"
        : arg.includes("[ ! -e")
          ? "<verify>"
          : arg.includes(".t3ck-nuke-marker")
            ? "<marker>"
            : arg,
    ),
  );

describe.skipIf(!launcherAvailable("v2"))("v2 characterization", () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const fixtures = makeFixtures();
      try {
        const run = (port: number) => runCase(fixtures, "v2", testCase, port);
        const result = testCase.server ? await withServer(run) : await run(40_773);
        const goldenPath = join(goldenDir, `${slug(testCase.name)}.json`);
        const golden = readGolden(goldenPath);
        const expected = V2_OVERRIDES[testCase.name] ?? golden;

        expect(result.exit, goldenPath).toBe(expected.exit);
        expect(result.calls, goldenPath).toEqual(expected.calls);
        expect(result.warnings, goldenPath).toEqual(expected.warnings);

        for (const text of testCase.stdout ?? []) {
          expect(result.stdout, `${goldenPath}: ${text}`).toContain(text);
        }
      } finally {
        rmSync(fixtures.dir, { recursive: true, force: true });
      }
    });
  }
});

describe.skipIf(!launcherAvailable("v2"))("v2 destructive verbs", () => {
  for (const testCase of V2_NUKE_CASES) {
    it(testCase.name, async () => {
      const fixtures = makeFixtures();
      try {
        const result = await runCase(
          fixtures,
          "v2",
          { name: testCase.name, args: [...testCase.args], scenario: testCase.scenario },
          40_773,
        );

        expect(result.exit).toBe(testCase.exit);
        expect(normalizeScripts(result.calls)).toEqual(testCase.calls);
        expect(result.warnings).toEqual(testCase.warnings);

        for (const text of testCase.stdout ?? []) {
          expect(result.stdout).toContain(text);
        }
      } finally {
        rmSync(fixtures.dir, { recursive: true, force: true });
      }
    });
  }
});

function readGolden(path: string): Golden {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as Golden;
  throw new Error(`missing golden ${path}; run: node scripts/characterization/update.ts`);
}
