# Agent patterns

Project-local notes that point an agent at the right part of the vendored
Effect source. They are deliberately short: the source in `repos/effect/` is
the reference, and these files say where to look and which idioms this project
uses.

## Why `repos/effect` exists

Following [Effect's advice on coding agents](https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive),
the Effect repository is vendored as a git subtree so an agent can read the
real implementation, tests, and examples instead of guessing from documentation
or repeatedly fetching snippets. `node_modules/effect` is not enough: it is
gitignored, and its `src` is a published copy rather than the repository an
agent can explore.

The subtree is pinned to the **`effect@4.1.2`** tag (commit `506eef143b`), the
same version the workspace overrides in `package.json`.

## Update it

```sh
git subtree pull \
  --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git \
  effect@4.1.2 \
  --squash
```

Change the tag in the same commit as the `effect` override in the root
`package.json` and the `effect` pins in the workspace manifests. A subtree that
drifts from the installed version teaches the agent the wrong API.

## Read it in this order

1. `repos/effect/LLMS.md` — the generated, task-oriented guide. Read it before
   writing any Effect code.
2. The pattern file for the area you are in:
   - [`effect-services.md`](./effect-services.md) — `Context.Service`,
     `Context.Reference`, `Layer`, `Effect.fn`, runtime boundaries.
   - [`effect-process.md`](./effect-process.md) — `ChildProcess`,
     `ChildProcessSpawner`, `Scope`, timeouts, streams.
   - [`effect-errors.md`](./effect-errors.md) — `Schema.TaggedError`,
     `catchTags`, safe attributes.
   - [`effect-testing.md`](./effect-testing.md) — `@effect/vitest`, layers,
     fake services.
3. The source itself:
   - `repos/effect/packages/effect/src/` — the library.
   - `repos/effect/packages/platform/node/src/` — `NodeServices`.
   - `repos/effect/ai-docs/src/` — runnable examples behind `LLMS.md`.
   - `repos/effect/packages/effect/SCHEMA.md` — the Schema guide.

## Rules

- `repos/` is read-only reference material. Do not edit it, and do not import
  from it: application code imports `effect`, `effect/process`, and
  `@effect/platform-node` from `node_modules`.
- Prefer a pattern you can point at in `repos/effect` over one you remember.
- The vendored repository has its own tests and configs. They are excluded from
  this workspace's `vp test`, `vp lint`, `vp fmt`, and `tsc`; do not "fix" them.
