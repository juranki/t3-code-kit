# Skills are baked into the image, not kept on a volume

The skills the documented workflow depends on (`/triage`, `/code-review`,
`/grill-with-docs`, `/wayfinder`) live in the image layer at
`/home/agent/.agents/skills`, baked in at build time by the `skills` CLI from a
pinned commit. A skill you add by hand does not survive a rebuild, and a volume
over `/home/agent/.agents` would shadow whatever the image contains while still
starting empty on a _new_ sandbox — it only helps the sandbox where you already
ran the CLI by hand. Baking in is the only shape where "the image is the
environment" holds.

## Considered Options

- **Volume over `/home/agent/.agents`.** Rejected: shadows the image (the same
  trap the `.t3` volume note warns about), and a new sandbox still starts with
  no skills. It preserves state, not setup.
- **Restore from the CLI's lock file (`experimental_install`).** Rejected: it
  restores a _project-scope_ `skills-lock.json` into `.agents/skills` without
  agent links, and a lock written without a ref pins content, not a version.
  The Dockerfile's `SKILLS_REF` is the pin.

## Consequences

Changing a skill is a `SKILLS_REF` bump and a `t3-code-kit rebuild`;
`skills add` inside a running sandbox is wiped by the next rebuild.
`kit/skills.txt` is the selection, and the build fails if the count in the
image disagrees with it — the CLI ignores an unknown name silently, so without
that assertion a renamed skill would be baked in as a smaller set with a green
build.
