#!/usr/bin/env node
// The v2 CLI entry. The real verbs land in #36 and #37; until then every
// `npm run <verb>` reaches this and exits 2, the usage exit code the old
// launchers used. `import.meta.main` keeps the module importable by tests.
if (import.meta.main) {
  process.stderr.write("t3-code-kit: the v2 CLI is not implemented yet (v2 map #29)\n");
  process.exit(2);
}
