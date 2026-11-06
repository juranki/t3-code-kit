<img src="assets/icon.svg" width="64" height="64" alt="">

# t3-code-kit

**Run [T3 Code](https://t3.codes) with [pi](https://github.com/earendil-works/pi)
or [Codex](https://developers.openai.com/codex/cli) inside a [Docker
Sandbox](https://docs.docker.com/ai/sandboxes/), and drive it from a browser on
the host.**

Nothing is installed on the host. Nothing on the host is reachable from the
sandbox. An agent running with full permissions can rewrite anything it can
see — and what it can see is one microVM with its own kernel, its own network
policy, and no mount of your filesystem.

## The blast radius

|                                       |                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sandbox can reach                 | its own volumes, the hosts in [`policy/allow.txt`](policy/allow.txt), and GitHub through a proxy-injected credential                                                                    |
| The sandbox cannot reach              | your filesystem, your home directory, your other repos, your SSH agent, your keychain                                                                                                   |
| Code goes in                          | `git clone`, inside the sandbox                                                                                                                                                         |
| Code comes out                        | `git push` a branch; you review and merge on the host                                                                                                                                   |
| Survives `stop` / `rebuild` / restart | repos, t3 threads, worktrees — they live on volumes (`workspace`, `.t3/userdata`, `.t3/projects`, `.t3/worktrees`); `sbx` reattaches them when the same name and kit are used (v0.50.1) |
| Survives `nuke`                       | nothing — `nuke` wipes those four volumes' contents, then removes the instance; the volume objects stay allocated, empty ([ADR 0003](docs/adr/0003-durability-model.md))                |

The descriptor, [`kit/t3-code.yaml`](kit/t3-code.yaml), is normative. A Kit
carries its authority in the image, under one digest, so the egress lists live
there. [`policy/allow.txt`](policy/allow.txt) (runtime) and
[`policy/install.txt`](policy/install.txt) (build time) are the copies you
read, and `npm run smoke` fails if either disagrees with the descriptor. The
two files are separate on purpose: `npm run policy` prints only the runtime
one, so a build-time host listed there would read as a runtime permission.

⚠️ This is a _containment_ boundary, not a convenience wrapper. If you want to
edit the same files in your editor and in the agent's sandbox, this kit is the
wrong tool. It deliberately gives you no host mount.

## Install

On the host:

- **Node 26.13.0 and Vite+ 1.5.0 (`vp`)**. The Vite+ installer provides both;
  there is no separate Node install to keep in step.
- [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/install/) (`sbx`):
  macOS 14+ on Apple silicon, Windows 11 x64, or Ubuntu 24.04+ with KVM.
- **No Docker Engine or Docker Desktop.** You need neither: the Kit is built
  in a builder sandbox (`SBX_KIT_BUILDER=sandbox`, the default here) rather
  than with the host's Buildx. The first `up` therefore builds slowly. It pulls
  a base image, then t3 and pi.

Install Vite+, clone, and install the workspace:

```sh
# macOS / Linux
curl -fsSL https://vite.plus | bash
```

```powershell
# Windows — PowerShell ships with Windows; this is not a PowerShell launcher
irm https://vite.plus/ps1 | iex
```

```sh
git clone https://github.com/juranki/t3-code-kit
cd t3-code-kit
npm ci
```

`npm run` lists the verbs; `npm run help` prints the usage. There is no
installer, no npm package, and no `bin/` shim: it is an npm workspace, a
Dockerfile, and a descriptor.

### The first run, by hand

Do the first run by hand. `sbx` needs a GitHub credential and a model provider
key, and it only asks interactively for the **binding**: the record of which kit
may use which service. A stored secret is not an approval, and the CLI creates
sandboxes detached. A first run through `npm run up` therefore starts with the
credential withheld and warns.

```sh
sbx login                             # Docker OAuth; no sandbox runs without it
sbx secret set github                 # the value, first
sbx secret set mistral                # ...and pi's provider's
sbx secret set openai                 # ...and Codex's, if you enable it
sbx create --name myproject ./kit     # approve the credential prompts
sbx run --name myproject              # start it; Ctrl-\ detaches
```

On Windows the same commands run in PowerShell, with `.\kit` in place of
`./kit`.

⚠️ `sbx create` does **not** start the workload. It prints `try: sbx run --name
<name>` and stops there. The sandbox shows as running, the published port
accepts connections and immediately resets, and nothing serves. Approving a
credential with no stored secret binds nothing, which is why the approval
prompt can be followed by `no binding authorizes this service`.

After that, `npm run up -- myproject` reuses the binding.

Four things are left, and all four are in
[`docs/host-setup.md`](docs/host-setup.md): writing the binding file yourself, a
host port other than 3773, a clone from before `.gitattributes`, and the one
step in the t3 UI.

## Use

```sh
npm run up -- myproject     # create, publish the port, print the pairing URL
```

`up` uses `sbx create`, not `sbx run`: `run` always bind-mounts a workspace, and
with no path argument it mounts the current directory. `create` with no path is
the mountless form, which is what keeps the host filesystem out of reach.

Open the printed `http://localhost:3773/pair#token=…` in your browser. That is
the whole workflow: the t3 web UI runs in the sandbox, and pi and Codex are the
agents it can drive.

```sh
npm run url -- myproject      # mint a fresh pairing URL
npm run logs -- myproject     # tail the server log inside the sandbox
npm run shell -- myproject    # bash inside the sandbox
npm run refresh -- myproject  # restart, which also refreshes the catalog
npm run down -- myproject     # stop; repos and threads survive
npm run rebuild -- myproject  # recreate from a freshly built image; repos and t3 state survive
npm run nuke -- myproject     # wipe its data, then remove it (volumes stay allocated, empty)
npm run policy                # print the runtime egress allowlist
npm run doctor                # what this host's sbx reports
```

`nuke` asks you to type the sandbox name before it wipes anything. In a
non-interactive shell, pass `--yes`.

One sandbox per project. `T3CK_NAME` sets the default name, `T3CK_PORT` the
host port (3773).

Two things bite on repeat runs:

- `up` on an existing sandbox **reuses the image it was created from**. After
  changing anything under `kit/`, use `rebuild`. Otherwise you are restarting a
  sandbox that still contains the old image, and the fix you just pulled is not
  in it.
- The published port is **host-local**: `sbx` binds `127.0.0.1` by design, so
  the browser must be on the same machine. Remote access needs an SSH tunnel.
  `--tailscale-serve` will not work inside a sandbox, because `sbx` blocks UDP
  and proxies TCP.

### Commits made in the sandbox

`up` sets the sandbox's git identity from your host's own config, so a commit
made by the agent is authored by you. Because the email is yours, it also links
to your GitHub account:

```
Agent for Juhani Ränkimies <juhani@example.com>
```

The `Agent for ` prefix is deliberate. It says an agent, not the human, made the
commit. The email is your real one, because that is what GitHub matches on.

- Set `git config --global user.name` / `user.email` on the host first. With
  neither set, `up` warns and falls back to `Agent <agent@t3-code-kit>`, which
  names no person and links to no account.
- `T3CK_AGENT_NAME_PREFIX` overrides the prefix. Set it empty for the bare host
  name.
- `up` re-asserts the identity every time, so a `git config` you set by hand
  inside the sandbox is reverted. It prints the identity it applied.

See [`docs/adr/0005-git-identity-from-host.md`](docs/adr/0005-git-identity-from-host.md).

## Skills

The agent workflow these docs describe — `/triage`, `/code-review`,
`/grill-with-docs`, `/wayfinder` — is **baked into the image**, at
`/home/agent/.agents/skills`. The build adds it from
[`mattpocock/skills`](https://github.com/mattpocock/skills), pinned to a commit
and a CLI version, and bakes the names listed in
[`kit/skills.txt`](kit/skills.txt). Changing them is a `rebuild`, not an
in-sandbox change; why they are baked in and not a volume is
[ADR 0001](docs/adr/0001-skills-baked-into-image.md). pi and Codex share the
same global directory, so one install serves both.

## Toolchains

The image bakes node, go, and python through [`mise`](https://mise.jdx.dev) at
the `nodeVersion` / `goVersion` / `pythonVersion` kit args, plus Vite+, `fd`,
Codex, and T3's preview browser. A repo's `.mise.toml` selects a version but
cannot install one: the build installs exactly one line per tool, so a
different version is a kit-arg change and a `rebuild`. Pins, Java, and the
`403`-means-allowlist failure are in [`docs/toolchains.md`](docs/toolchains.md).

## Verify

```sh
npm ci               # the workspace, from the committed lockfile
npm run check        # fmt, lint, typecheck, and the unit/characterization suite
npm run smoke        # macOS, Linux, and Windows; uses t3ck-smoke
npm run doctor       # what this host's sbx reports: version and capabilities
```

`npm run smoke` brings a sandbox up, waits for the server, mints a pairing URL,
and proves the toolchain, Codex, the preview browser, the volume, GitHub
egress, and the durability model. It ends with the sandbox nuked, so give it a
dedicated name: `npm run smoke -- <name>`, or `T3CK_NAME`. The pi round-trip is
off by default because it spends real model tokens; `SMOKE_AGENT=1` turns it
on. The `SMOKE_*` reference is in
[`docs/operations/v2-dev-loop.md`](docs/operations/v2-dev-loop.md).

## Limits

- ⚠️ **`nuke` is the only verb that destroys data**, and it destroys all of it:
  it wipes the four volumes' contents from inside the sandbox, then removes the
  instance. `sbx` has no per-sandbox purge, so the volume objects stay
  allocated, empty. See [ADR 0003](docs/adr/0003-durability-model.md).
- ⚠️ **[Kits v3](https://github.com/docker/sandbox-kit-spec) is Early Access and
  the spec is experimental** (a final version is targeted for Q4 2026). The kit
  descriptor, the base image reference, and the `sbx` verbs are the parts most
  likely to move under you.
- ⚠️ **No self-update inside the sandbox.** t3, the skills, Vite+, fd, Codex,
  and T3's preview browser are pinned at build time; pi defaults to `latest`.
  Bumping any of them is a `rebuild`. The browser's `CHROME_VERSION` is a plain
  `ARG` rather than a kit arg, because it has to track the t3 binary instead of
  being chosen.
- **Two providers ship** (pi and Codex). pi is the default; Codex is baked and
  enabled, and shows as unauthenticated until you set the `openai` secret and
  approve its binding. Adding another provider is one Dockerfile block, one
  credential, and one egress entry.
- **Codex takes an OpenAI API key or a ChatGPT plan.** Both are proxy-injected:
  the sandbox holds a sentinel, and the proxy swaps it on egress. OAuth mode
  routes model calls through `chatgpt.com/backend-api/codex`; API-key mode uses
  the default OpenAI provider. The `openai` service is shared with pi: if you
  point pi at openai too, the two credentials collide on `(openai, runtime)`,
  so keep pi on a different provider. See
  [ADR 0006](docs/adr/0006-codex-as-second-agent.md).
- **GitHub is the only git host wired in.** t3 itself supports Bitbucket,
  GitLab, and Gitea/Codeberg too, but the Kit ships one credential and one
  host's allowlist entries. Adding another is the same kind of three-part change
  as adding a provider: a credential, its `inject` rule, and its runtime
  allowlist entry. Until then a `403` on that host is a policy decision, not a
  broken network.
- **The real-`sbx` proof is host-only.** The Linux sandbox runs the fast gate;
  the Windows host runs the smoke suite against `sbx.exe`. The acceptance run is
  recorded in
  [`docs/operations/v2-final-acceptance.md`](docs/operations/v2-final-acceptance.md).

## Troubleshooting

Every failure, by symptom, is in
[`docs/troubleshooting.md`](docs/troubleshooting.md):

- **Nothing renders or connects:** a stale model list, a pairing URL that does
  not open, `ERR_CERT_AUTHORITY_INVALID` in the preview browser.
- **Credentials and egress:** `401 Invalid API Key`, and a `403` where an agent
  expected an API.
- **The sandbox itself:** a missing `serve.log`, a `json: unknown field`
  descriptor error, a missing `t3` binary, a Kit or sandbox that will not
  start.

## Further reading

- [`docs/host-setup.md`](docs/host-setup.md) — the host steps the kit cannot automate
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — every failure, by symptom
- [`docs/toolchains.md`](docs/toolchains.md) — the baked toolchain and its pins
- [`docs/operations/v2-dev-loop.md`](docs/operations/v2-dev-loop.md) — working on the kit itself
- [`docs/design/sbx-seam.md`](docs/design/sbx-seam.md) — how the CLI talks to `sbx`
- [`docs/adr/`](docs/adr/) — the decisions behind the above
- [`GLOSSARY.md`](GLOSSARY.md) — the words these docs use
- [`prototype/spike.md`](prototype/spike.md) — what was verified before any of this was written

## License

MIT — see [`LICENSE`](LICENSE).

Parts of this repo derive from other MIT-licensed projects: `HostProcess.ts` is
transcribed from [t3code](https://github.com/pingdotgg/t3code), and
`repos/effect` vendors [Effect](https://github.com/Effect-TS/effect). Their
notices are reproduced in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
