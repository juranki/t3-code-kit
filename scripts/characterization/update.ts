// Regenerate the golden files from the v2 CLI as it is today. Review the diff:
// an argv change is the thing this suite exists to make visible. Run
// `npm run fmt` afterwards; the formatter owns the JSON layout.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CASES, type Golden, makeFixtures, runCase, slug, withServer } from "./harness.ts";

const goldenDir = join(import.meta.dirname, "golden");
mkdirSync(goldenDir, { recursive: true });

if (process.platform === "win32") {
  throw new Error("the fake sbx is not executable by the seam on Windows; run this on macOS/Linux");
}

for (const testCase of CASES) {
  const fixtures = makeFixtures();
  try {
    const run = (port: number) => runCase(fixtures, testCase, port);

    // Sequential on purpose: the cases share the host's ports and temp dirs,
    // and a failure should point at one case, not a fan-out.
    // eslint-disable-next-line no-await-in-loop
    const result = testCase.server ? await withServer(run) : await run(40_773);

    const golden: Golden = {
      exit: result.exit,
      calls: result.calls,
      warnings: result.warnings,
    };

    writeFileSync(
      join(goldenDir, `${slug(testCase.name)}.json`),
      `${JSON.stringify(golden, null, 2)}\n`,
    );
  } finally {
    rmSync(fixtures.dir, { recursive: true, force: true });
  }
}
