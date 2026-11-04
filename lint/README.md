# Lint rules

The conventions in [`AGENTS.md`](../AGENTS.md) and
[`docs/design/sbx-seam.md`](../docs/design/sbx-seam.md) are enforced here. Each
rule lives in [`rules.js`](./rules.js), is registered in `vite.config.ts` under
`lint.jsPlugins`, and is enabled at `error`, so a violation fails `npm run
check`. `npm run lint` runs `vp lint --deny-warnings`, so a warning fails it
too: see [`CODING_STANDARDS.md`](../CODING_STANDARDS.md).

The Effect diagnostics are configured in the same `lint` block: `lint.rules`
pins the severities the TypeScript plugin block used to declare, and
`lint.overrides` carries the per-file exemptions. The editor's plugin block in
`tsconfig.json` has `diagnostics: false`, so Oxlint is the single reporter.

## Rules

| Rule                        | Enforces                                                                                                                          | Applies to                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `t3ck/no-vendored-import`   | "Do not import from `repos/`." The vendored tree is read-only reference source.                                                   | Every linted file.                                                        |
| `t3ck/host-process-only`    | "`process` and `node:os` only in the host-process module." Node builtins and the `process` global are read through `HostProcess`. | Production source, except `packages/host/src/HostProcess.ts`.             |
| `t3ck/no-stderr-switch`     | "The tag is the contract; `stderr` is an attribute, never the switch." Branch on `_tag`, not on `stderr` text.                    | Production source, except `packages/sbx/src` (the seam's quirk boundary). |
| `t3ck/no-render-to-shell`   | "`command.render` is for logs and tests and must never reach a shell."                                                            | Every linted file.                                                        |
| `t3ck/no-argv-join`         | "The seam never joins argv into a string." A multi-line script stays one argv element.                                            | Production source, except `packages/sbx/src/command.ts` (owns `render`).  |
| `t3ck/exec-vs-exec-checked` | `exec` is exit-code-as-data; `execChecked` is for an action whose non-zero exit is a failure.                                     | Production source, except `packages/sbx/src` (the seam implements both).  |

### `t3ck/no-vendored-import`

Catches static imports, re-exports, dynamic `import()`, and `require()` whose
specifier resolves into `repos/`. The vendored Effect tree is a reference copy,
not a dependency; application code imports the published packages.

### `t3ck/host-process-only`

Catches any `node:*` import (including `node:os` and `node:fs`) and any read of
the global `process` in workspace source. `packages/host/src/HostProcess.ts` is
the one module that turns those host facts into `Context.Reference`s; everything
else reads the reference. Tests and the host probe scripts are outside the
rule's scope because they are not the shipped program.

### `t3ck/no-stderr-switch`

Catches control-flow that inspects `stderr` content: `.includes`, `.match`,
`.startsWith`, `.endsWith`, `.indexOf`, `.search`, a direct comparison, a bare
`stderr` condition, and `switch (stderr)`. A `stderr.length` guard used only to
decide whether to print the attribute is not a switch and is allowed. The seam
(`packages/sbx/src`) is exempt because translating `sbx`'s text into a tagged
error is its job; callers switch on the tag.

### `t3ck/no-render-to-shell`

Catches a `command.render(...)` result (directly, through a template literal or
array, or through a variable assigned from it) passed to a shell or process
launcher: `exec`, `execSync`, `execFile`, `execFileSync`, `spawn`, `spawnSync`,
`sh`, `bash`, `run`, `runSync`, `runCommand`. Rendering is for logs and tests;
the seam takes the argv array.

### `t3ck/no-argv-join`

Catches `.join(...)` on `args`/`argv` (including `args.slice(...).join(...)` and
`[...args].join(...)`) in workspace source. The one exception is
`packages/sbx/src/command.ts`, which owns `render` and is the sanctioned
log/test formatter.

### `t3ck/exec-vs-exec-checked`

Catches two mistakes in the CLI:

- an `sbx.exec(...)` result whose `exitCode` is never read — the caller wanted
  `execChecked`;
- an `sbx.execChecked(...)` result whose `exitCode` is read — it is always `0`,
  so the caller wanted `exec`.

## Adding a rule

1. Add a `defineRule` to `rules.js` and export it from the plugin's `rules`
   object.
2. Enable it in `vite.config.ts` under `lint.rules` at `error` (or in an
   `overrides` entry for a narrower scope).
3. Add a row to the table above.
4. Prove it fails: create a temporary file that violates the rule, run
   `./node_modules/.bin/vp lint <file>`, then delete the file. Do not leave a
   violating file in the tree.
