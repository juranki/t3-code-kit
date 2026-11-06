# v2 is an npm workspace with no build step and no package

The v2 CLI replaces the `sh` and PowerShell twins with one TypeScript program,
so the repo needs a workspace shape and a way to run it. It gets npm
workspaces — `packages/{host,sbx,kit}` for libraries, `apps/cli` for the
program, `scripts/` for repo tooling — with Node 26 running the TypeScript
directly and `npm run <verb>` as the only entry point. There is no build step,
no npm package, no installer, and no `bin/` shim.

This diverges from the v2 map's Notes, which asked for t3code's pnpm 12.14.0
and its `catalog:` / `patchedDependencies` / `packageExtensions` machinery.
That machinery solves pnpm-strictness problems this repo does not have, and
the divergence is recorded here rather than left to be rediscovered.

## Considered Options

**pnpm 12.14.0 and the t3code catalog — rejected.** Each of t3code's three
pnpm mechanisms fixes a pnpm-specific failure. `patchedDependencies` exists
because pnpm's strict layout hides `vitest` from `@effect/vitest`, so the
published package's `from "vitest"` cannot resolve and the patch rewrites it to
`vite-plus/test`. `catalog:` keeps one version per dependency across ~40
packages. `packageExtensions` supplies the peer that patch implies. A probe
showed none of it is needed under npm: installing `vite-plus@1.4.0`,
`effect@4.1.2` and `@effect/vitest@4.1.2` hoists `vitest@5.0.5` (vite-plus's
own dependency), the _unpatched_ `from "vitest"` resolves to it, and
`it.effect` runs under `vp test`. A second probe in a two-package npm
workspace confirmed the real shape: `vp test run` at the root and
`vp test run --config ../../vite.config.ts --dir .` from a package both pass,
and a package imports another's `src/*.ts` through its `exports` subpath. Root
`overrides` pin `effect`, `vitest`, `vite` and `typescript`, which is the
single-copy guarantee the catalog was buying.

The `vite` override is the one that is not obvious. `vite-plus` depends on
`vite` as an npm alias (`npm:@voidzero-dev/vite-plus-core@1.4.0`), and vitest
wants a _real_ `vite` peer. Left alone, npm installs registry `vite@8.3.5` at
the root to satisfy the peer and nests the alias under `vite-plus`, so `vp test`
runs against a different Vite than the toolchain does — and on a fresh install
it fails outright with `Cannot find package 'vite'`. Overriding `vite` to the
alias collapses it to one copy and makes npm warn that it overrode a peer
range, which is exactly what t3code's `peerDependencyRules.allowAny: [vite]`
does on the pnpm side.

The `typescript` override is the second. `vite-plus-core` declares
`peerOptional typescript@^5 || ^6 || ^7`, and the workspace's `typescript` is
the `@tsc-rs/typescript@0.8.0` alias, so npm wants registry `typescript@7.0.2`
beside it. On Linux that resolves with a warning; on Windows the same tree
fails with `ERESOLVE could not resolve`. The failure is platform-dependent,
which is why a green install on one host proves nothing about the other — and
why the override, not a `--legacy-peer-deps` flag, is the fix: it makes the
resolution identical everywhere. t3code needs the same exemption
(`peerDependencyRules.allowAny: [typescript, vite]`), which is the
confirmation that this is not a local workaround.

A third override, `@effect/platform-node-shared`, existed while `effect` was
4.0.5 and is now gone. `@effect/platform-node@4.0.5` declared
`@effect/platform-node-shared: ^4.0.5`, so npm installed 4.1.1, and 4.1.1
imports `effect/dist/process/CommandLine.js` — a path that only exists in
`effect@4.1.x`, while the root override pinned `effect` to 4.0.5. Nothing
imported `NodeServices` before the live `Sbx` adapter, so the mismatch stayed
invisible; it only failed when the platform-node entry point was actually
loaded. Pinning shared to `4.0.5` kept the pair in step, at the cost of a
nested copy under `@effect/platform-node`.

`effect` 4.1.2 ships a matching `@effect/platform-node-shared` —
`@effect/platform-node@4.1.2` declares it exactly — so the override has
nothing left to pin and #75 deleted it. The lesson it leaves behind is the one
worth keeping: a dependency that only one code path loads can hide a version
mismatch from the whole test suite.

**A single package at the repo root — rejected.** The seam is the point:
`packages/sbx` has two consumers that must not share a process (the CLI verbs
and the smoke suite), and `packages/kit` is pure data that three callers share.
One package would either bury `sbx` in the CLI or duplicate it.

**A real build (`vp pack` → `dist/`) — rejected.** Node 26 strips types, every
package's `exports` points at `src/*.ts`, and `allowImportingTsExtensions` plus
`rewriteRelativeImportExtensions` are on. A `dist/` would add a stale-artifact
class of bug and a second copy of the truth, for nothing: nothing is published.

**`node --run <verb>` — rejected.** It is the quieter, more modern invocation,
but it collapses exit codes: a script exiting 2 exits 1 under `node --run` and
2 under `npm run`. The port has to preserve exit codes, so `npm run` wins
despite printing its `> script` header on stdout.

## Consequences

- **`npm run` is the interface.** One root script per verb
  (`npm run up -- myproject`), plus `help`, `test`, `typecheck`, `lint`, `fmt`,
  `fmt:check`, `check`, `smoke`. Bare `npm run` is the verb list; `npm run help`
  prints the usage. The header goes to stdout, so anything capturing output
  (the pairing URL) uses `npm run -s`.
- **`bin/` is gone.** #42 deleted the `sh` and PowerShell launchers and the
  shell test harness: `bin/test` became `npm test`, `bin/smoke` became
  `npm run smoke`, and the launchers became `apps/cli`. No program answers to
  `t3-code-kit` any more; the project name survives only in the error prefix
  and the docs.
- **One exact Node pin, `26.13.0`**, in `engines.node` and — via #41 — in the
  image's `nodeVersion`/`NODE_VERSION`. `@types/node` stays at t3code's
  `24.12.4`; bump it only when a Node 26 API is actually needed, and say why.
- **The phantom-dependency guardrail is gone.** pnpm's strict `node_modules`
  would have failed an import of a package that was never declared; npm hoists
  and lets it resolve. That is the one guardrail traded away, accepted because
  the workspace is four packages and the alternative costs a patch file, a
  catalog, and a host install step.
- **One root `tsconfig.json`**, not `tsconfig.base.json` plus per-package
  extends. The split exists for per-package typecheck caching at t3code's
  scale; four packages and one `tsc --noEmit` do not need it. Split it when
  typecheck time hurts.
- **`packages/kit` is pure data** — no `Context.Service`, no `sbx` knowledge —
  so the `policy` verb and the smoke suite can share it. It folds into
  `packages/sbx` only if the whole workspace lands under ~1,200 lines.
- **Package names are `@t3ck/*` and every manifest is private.** With nothing
  published they are import specifiers, not a distribution surface: no `bin`,
  no `files`, no `main`, no `types`.
- **Exports are subpath-only and point at source**, enforced by
  `scripts/layout.test.ts` together with the package set, the dependency
  edges, the Node pin, and the `overrides`. The same test asserts that the
  image bakes the same Node version, and that the Vite+ and fd pins match the
  descriptor.
- **The `@effect/language-service` diagnostics run in `tsc --noEmit`, not just
  the editor**: `tsc-rs` executes the tsconfig `plugins` block. Verified by the
  `unstableApiUsage` warnings it emitted on every `it` in the layout test, which
  is why that one diagnostic is off with a reason. Two exemptions exist and
  both are named: `packages/host/src/HostProcess.ts` for `nodeBuiltinImport`
  (it is where `process` and `node:os` become references), and `**/*.test.ts`
  for `nodeBuiltinImport`/`preferSchemaOverJson`/`effectFnOpportunity`.
- **npm 11 does not run `@tsc-rs/typescript`'s postinstall** unless it is
  approved (`npm install-scripts approve @tsc-rs/typescript`). `tsc` still
  works on linux-x64 because the compiler ships as a platform
  `optionalDependency`; approve the script if a host ever reports a missing
  binary.
