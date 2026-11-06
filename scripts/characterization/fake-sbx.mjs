#!/usr/bin/env node
// A scripted `sbx` for the characterization suite. It records every argv it was
// handed, then answers from a scenario file: the first rule whose `match` is a
// prefix of the argv (and whose `contains` substrings all appear) wins, and `*`
// matches any single word. The CLI is the thing under test, so this
// never decides anything itself.
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
// `--no-input` is a global flag the seam puts before the verb. The rules match
// from the verb; the golden records the full argv, so the flag is still pinned.
const verbArgv = argv[0] === "--no-input" ? argv.slice(1) : argv;

const log = process.env.FAKE_SBX_LOG;
if (log) appendFileSync(log, `${JSON.stringify({ argv })}\n`);

const scenarioPath = process.env.FAKE_SBX_SCENARIO;
const scenario = scenarioPath ? JSON.parse(readFileSync(scenarioPath, "utf8")) : {};

const matches = (rule) => {
  const prefix = rule.match ?? [];
  const prefixOk = prefix.every((word, index) => word === "*" || verbArgv[index] === word);
  const containsOk = (rule.contains ?? []).every((needle) =>
    argv.some((word) => word.includes(needle)),
  );
  return prefixOk && containsOk;
};

const rule = (scenario.calls ?? []).find(matches) ?? scenario.default ?? {};

if (rule.stdout) process.stdout.write(rule.stdout);
if (rule.stderr) process.stderr.write(rule.stderr);
process.exitCode = rule.exit ?? 0;
