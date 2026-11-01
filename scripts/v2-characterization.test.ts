// The v2 parity guardrail for the verbs #37 ports. It runs the same cases as
// the launcher characterization suite, but against `apps/cli/src/bin.ts` and
// only for the verbs that exist today. `rebuild` and `nuke` join it in #39.
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
  slug,
  withServer,
} from "./characterization/harness.ts";

const goldenDir = join(import.meta.dirname, "characterization", "golden");

// The verbs #37 owns. The destructive verbs are #39's, and their v2 argv will
// be different by design (ADR 0003), so they are not compared here.
const DESTRUCTIVE = new Set([
  "rebuild",
  "rebuild rm fails",
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

const cases = CASES.filter((testCase) => !DESTRUCTIVE.has(testCase.name));

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

function readGolden(path: string): Golden {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as Golden;
  throw new Error(`missing golden ${path}; run: node scripts/characterization/update.ts`);
}
