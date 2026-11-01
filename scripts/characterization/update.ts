// Regenerate the golden files from the launchers as they are today. ps1 is the
// reference; a case that records an sh divergence also runs sh and stores its
// sequence under `sh`. Review the diff: an argv change is the thing this suite
// exists to make visible. Run `npm run fmt` afterwards; the formatter owns the
// JSON layout.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CASES,
  type Golden,
  type LauncherName,
  launcherAvailable,
  makeFixtures,
  runCase,
  slug,
  withServer,
} from "./harness.ts";

const goldenDir = join(import.meta.dirname, "golden");
mkdirSync(goldenDir, { recursive: true });

// Both launchers must be present: ps1 is the reference, and sh supplies the
// divergence overrides. Regenerating on a host with only one of them would
// silently rewrite the contract from the wrong side.
for (const launcher of ["ps1", "sh"] as const) {
  if (!launcherAvailable(launcher)) {
    throw new Error(`cannot regenerate goldens without ${launcher}`);
  }
}

const reference: LauncherName = "ps1";
const other: LauncherName = "sh";

for (const testCase of CASES) {
  const fixtures = makeFixtures();
  try {
    const run = (launcher: LauncherName) => (port: number) =>
      runCase(fixtures, launcher, testCase, port);

    // Sequential on purpose: the cases share the host's ports and temp dirs,
    // and a failure should point at one case, not a fan-out.
    // eslint-disable-next-line no-await-in-loop
    const result = testCase.server ? await withServer(run(reference)) : await run(reference)(40773);

    const golden: Golden = {
      exit: result.exit,
      calls: result.calls,
      warnings: result.warnings,
    };

    if (testCase.sh && launcherAvailable(other)) {
      // eslint-disable-next-line no-await-in-loop
      const otherResult = testCase.server ? await withServer(run(other)) : await run(other)(40773);
      golden.sh = {
        exit: otherResult.exit,
        calls: otherResult.calls,
        warnings: otherResult.warnings,
        reason: testCase.sh.reason,
      };
    }

    writeFileSync(
      join(goldenDir, `${slug(testCase.name)}.json`),
      `${JSON.stringify(golden, null, 2)}\n`,
    );
  } finally {
    rmSync(fixtures.dir, { recursive: true, force: true });
  }
}
