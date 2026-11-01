# The sandbox's git identity is read from the host by the launcher

A commit made inside the sandbox was authored `agent <agent@t3.t3.docker.internal>`
— git's invention from the username and hostname, because nothing ever
configured `user.name`/`user.email`. The commit succeeds and pushes fine, so
the mistake is silent: it shows up only as a wrong author in the log, and on
GitHub as a commit that links to no account.

The launcher now reads the host's `git config --get user.name` and `user.email`
and asserts them into the sandbox on every `up`, with `sbx exec <name> -- git
config --global …`. The name is prefixed `Agent for `; the email passes through
untouched.

## Naming: the name is honesty, the email is linkage

A sandbox commit is made by an agent, so the author should say so, and
`Agent for Juhani Ränkimies` does. But a name is not what GitHub matches on —
attribution follows the *email*. That is why the two fields are treated
differently: the name is decorated, the email is not. Taking only the
decorated name would have left the issue's second complaint (no contribution
graph entry) unfixed.

The prefix is `T3CK_AGENT_NAME_PREFIX`, defaulting to `Agent for `. Setting it
to the empty string yields the bare host name; that is the documented opt-in to
plain attribution, kept opt-in because silent impersonation is the failure the
issue warns about.

With no host config at all the identity is `Agent <agent@t3-code-kit>`: it
names no person, which is the point. `up` warns and continues rather than
failing — a missing git config is not a reason to refuse to start a server.

That fallback does **not** link commits to an account, so the issue's second
harm is only closed on a host that has a git config. That is the honest trade:
the alternative is inventing an email address to link with, which is the same
class of mistake as inventing a name.

## Why the launcher, and not a credential

`credential@1` is the obvious-looking home for this and is the wrong one. It
carries a single `apiKey`, and its purpose is a value the proxy swaps in
*after* traffic leaves the VM — the sandbox itself must never hold the real
secret. A git identity is the opposite: not a secret, and it has to be readable
inside the sandbox as a plain value so `git` can use it. There is no
`proxyManaged: false` shape that makes it fit.

A `lifecycle@1` startup hook cannot do it either. Its `env` list is fixed in
the descriptor at build time, so it can never see the host's values.

## Considered Options

- **Have the agent infer the identity from repo history.** Rejected: it guesses
  from `git log` output and picks the wrong person on a repo with several
  contributors. Guessing is the bug, not the fix.
- **Document it and leave it to the user.** Rejected: it is what the repo
  effectively did before, and it failed — PR #20 shipped with the placeholder
  author. A fix you have to remember to apply is not a fix.
- **Only set the identity when it is unset.** Rejected: a wrong identity left
  by a previous run is exactly what needs correcting, so "already set" cannot
  mean "leave it alone".

## Consequences

`up` overwrites the identity unconditionally, so a `git config` set by hand
inside the sandbox is reverted on the next `up`. That is why `up` prints
`git identity: …` every time — the overwrite is visible rather than silent.
`T3CK_AGENT_NAME_PREFIX` is the supported way to want something different.

The `agent-context` block in `kit/t3-code.yaml` tells the agent the prefix is
deliberate and not to override it with `--author` or `-c user.name=…`. That
line is baked into the image, so changing it is a `rebuild`; the launcher half
takes effect on the next `up`.

`bin/smoke` can only check the identity's *shape* — it inspects a running
sandbox and never sees the host that created it. The exact value is asserted in
`bin/test`, against a stubbed `sbx` and `git`.
