# Coding standards

The gate is the standard. `npm run check` (format, lint, typecheck, tests) is
the definition of "green", and a change is not finished until it passes with no
output to explain away.

## A lint warning is a defect

A warning is a defect, not advice. `npm run lint` must exit 0 with **zero
warnings**; `vp lint --deny-warnings` is what enforces it, so a warning fails
the gate exactly like an error does.

That means:

- **Do not suppress a warning.** No `eslint-disable` / `oxlint-disable`
  comment, no `@ts-ignore`, no `@ts-expect-error`, no `as` / `as never` /
  `as any` added to quiet a rule.
- **Do not downgrade a warning's severity**, and do not move it to `off`.
- **Do not add the file to `lint.ignorePatterns`** (or `fmt.ignorePatterns`) to
  hide it.
- **Do not turn off `lint.options.typeAware`.** Type-aware linting stays on; the
  diagnostics that need types are the reason the rule set is worth having.
- **Fix the code.**

### When a warning cannot be fixed

If a warning cannot be fixed without changing behaviour or redesigning a seam,
**stop and report it** — the file, the line, the rule, and the reason — instead
of suppressing it. A warning that is genuinely wrong is a bug in the rule or in
the type, and it is fixed there, not muted at the call site.

## Severities

The Effect diagnostics (`effecttsgo/*`) and the project's own rules (`t3ck/*`)
stay at `error`. The only acceptable change to the lint configuration is making
warnings fail: `vp lint --deny-warnings` in `package.json`.

`lint/README.md` lists the `t3ck/*` rules and the sentence in `AGENTS.md` or
`docs/design/sbx-seam.md` each one enforces. `vite.config.ts` is the single
place severities are declared.

## The conventions themselves

This file does not restate them. They live in one place each:

| Where                                                  | What it settles                                                |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| [`AGENTS.md`](./AGENTS.md)                             | Workspace layout, durability, vendored repos, the lint rules.  |
| [`GLOSSARY.md`](./GLOSSARY.md)                         | The domain vocabulary: kit, pin, rebuild, durable state, nuke. |
| [`docs/adr/`](./docs/adr/)                             | Decisions that a later change would erode silently.            |
| [`docs/design/sbx-seam.md`](./docs/design/sbx-seam.md) | The `Sbx` seam: commands as data, the tag as the contract.     |
| [`lint/README.md`](./lint/README.md)                   | Each `t3ck/*` rule, what it catches, and how to add one.       |
| [`repos/effect/LLMS.md`](./repos/effect/LLMS.md)       | Idiomatic Effect: `Effect.gen`, `Effect.fn`, `Schema`.         |
| [`agent-patterns/`](./agent-patterns/)                 | Project-local notes on the same.                               |

When writing Effect code, `repos/effect/` is the source of truth for patterns;
it is read-only reference source and is never imported from.

## Adding or changing a rule

1. Add the rule to `lint/rules.js` and export it from the plugin (see
   `lint/README.md`).
2. Enable it in `vite.config.ts` at `error`, or in an `overrides` entry for a
   narrower scope. Never at `warn`: a rule that only warns is a rule that is
   not enforced.
3. Add a row to the table in `lint/README.md`.
4. Prove it fails: create a temporary file that violates the rule, run
   `./node_modules/.bin/vp lint <file>`, confirm the non-zero exit, then delete
   the file. Do not leave a violating file in the tree.
