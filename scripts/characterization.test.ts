// The parity guardrail. Every case runs against both launchers; ps1 is the
// reference because it is the one people actually use. The golden files hold
// the argv sequence, exit code, and warnings; stdout is asserted only where the
// value itself is the contract (a pairing URL, a log line, a volume name).
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

const launchers = (["sh", "ps1"] as const).filter(launcherAvailable);

describe("characterization", () => {
  for (const launcher of launchers) {
    describe(launcher, () => {
      for (const testCase of CASES) {
        it(testCase.name, async () => {
          const fixtures = makeFixtures();
          try {
            const run = (port: number) => runCase(fixtures, launcher, testCase, port);
            // 40773, not 3773: the container port is 3773, and normalizing
            // the host port must not swallow both halves of `-p`.
            const result = testCase.server ? await withServer(run) : await run(40773);
            const goldenPath = join(goldenDir, `${slug(testCase.name)}.json`);
            const golden = readGolden(goldenPath);
            const expected = launcher === "sh" && golden.sh ? golden.sh : golden;

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
  }
});

function readGolden(path: string): Golden {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as Golden;
  throw new Error(`missing golden ${path}; run: node scripts/characterization/update.ts`);
}
