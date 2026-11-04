// The CLI's characterization guardrail. Every case runs against
// `apps/cli/src/bin.ts` with executable fakes on PATH; the golden files hold
// the argv sequence, exit code, and warnings. stdout is asserted only where the
// value itself is the contract (a pairing URL, a log line, a volume name).
//
// This suite used to compare the `sh` and PowerShell launchers. They were
// retired in #42, so the goldens now pin the only implementation that ships.
import { describe, expect, it } from "@effect/vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as Schema from "effect/Schema";

import {
  CASES,
  Golden,
  makeFixtures,
  runCase,
  sandboxTable,
  type Rule,
  type Scenario,
  slug,
  withServer,
} from "./characterization/harness.ts";

const goldenDir = join(import.meta.dirname, "characterization", "golden");

interface NukeCase {
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
  match: ["exec"],
  contains: [".t3ck-nuke-marker", ">"],
  stdout: "",
};

const nukeWipe: Rule = {
  match: ["exec"],
  contains: ["-mindepth 1 -delete"],
  stdout: "",
};

const nukeVerify = (survivors = ""): Rule => ({
  match: ["exec"],
  contains: ["[ ! -e"],
  stdout: survivors,
});

const nukeRm = (response: { readonly exit?: number; readonly stderr?: string } = {}): Rule => ({
  match: ["rm", "--force", "*"],
  ...response,
});

const markerCall = ["exec", "<name>", "--", "sh", "-c", "<marker>"];
const wipeCall = ["exec", "-u", "root", "<name>", "--", "sh", "-c", "<wipe>"];
const verifyCall = ["exec", "<name>", "--", "sh", "-c", "<verify>"];
const missingRemedy =
  "no sandbox named '<name>': its volume contents may still be on disk. run 'npm run up -- <name>', then 'npm run nuke -- <name>'";

const NUKE_CASES: ReadonlyArray<NukeCase> = [
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

// The fake `sbx` is a PowerShell shim on Windows and the seam spawns `$SBX`
// directly, so this suite runs where the fixture is an executable script. The
// Windows proof is the real smoke suite.
describe.skipIf(process.platform === "win32")("CLI characterization", () => {
  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const fixtures = makeFixtures();
      try {
        const run = (port: number) => runCase(fixtures, testCase, port);
        const result = testCase.server ? await withServer(run) : await run(40_773);
        const goldenPath = join(goldenDir, `${slug(testCase.name)}.json`);
        const golden = readGolden(goldenPath);

        expect(result.exit, goldenPath).toBe(golden.exit);
        expect(result.calls, goldenPath).toEqual(golden.calls);
        expect(result.warnings, goldenPath).toEqual(golden.warnings);

        for (const text of testCase.stdout ?? []) {
          expect(result.stdout, `${goldenPath}: ${text}`).toContain(text);
        }
      } finally {
        rmSync(fixtures.dir, { recursive: true, force: true });
      }
    });
  }
});

describe.skipIf(process.platform === "win32")("CLI destructive verbs", () => {
  for (const testCase of NUKE_CASES) {
    it(testCase.name, async () => {
      const fixtures = makeFixtures();
      try {
        const result = await runCase(
          fixtures,
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
  if (existsSync(path))
    return Schema.decodeUnknownSync(Golden)(JSON.parse(readFileSync(path, "utf8")));
  throw new Error(`missing golden ${path}; run: node scripts/characterization/update.ts`);
}
