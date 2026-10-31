<img src="assets/icon.svg" width="64" height="64" alt="">

# t3-code-kit

**Run [T3 Code](https://t3.codes) with [pi](https://github.com/earendil-works/pi)
inside a [Docker Sandbox](https://docs.docker.com/ai/sandboxes/), and drive it
from a browser on the host.**

Nothing is installed on the host. Nothing on the host is reachable from the
sandbox. An agent running with full permissions can rewrite anything it can
see — and what it can see is one microVM with its own kernel, its own network
policy, and no mount of your filesystem.

## The blast radius

| | |
|---|---|
| The sandbox can reach | its own volumes, the hosts in [`policy/allow.txt`](policy/allow.txt), and GitHub through a proxy-injected credential |
| The sandbox cannot reach | your filesystem, your home directory, your other repos, your SSH agent, your keychain |
| Code goes in | `git clone`, inside the sandbox |
| Code comes out | `git push` a branch; you review and merge on the host |
| Survives `stop` / restart | repos, t3 threads, worktrees — they live on volumes (`workspace`, `.t3/userdata`, `.t3/projects`, `.t3/worktrees`) |
| Survives `nuke` | nothing |

⚠️ This is a *containment* boundary, not a convenience wrapper. If you want to
edit the same files in your editor and in the agent's sandbox, this kit is the
wrong tool — it deliberately gives you no host mount.

## Requirements

- [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/install/) (`sbx`) on
  the host: macOS 14+ on Apple silicon, Windows 11 x64, or Ubuntu 24.04+ with
  KVM. `sbx login` once.
- **No Docker Engine, and no Docker Desktop.** The Kit is built in a builder
  sandbox (`SBX_KIT_BUILDER=sandbox`, the default here) rather than with the
  host's Buildx. The first `up` therefore builds slowly — it pulls a base
  image, then t3 and pi.
- A GitHub credential in the sandbox credential store:
  `sbx secret set github`
- A model provider key for pi, likewise: `sbx secret set <provider>`

⚠️ **A stored secret is not an approval.** `sbx` keeps a binding in
`~/.config/sbx/credentials.yaml` recording which kit may use which service, and
it only asks for that approval **interactively**. The launcher creates sandboxes
detached, so the first run starts with the credential withheld and warns. Do the
first run by hand, once:

```sh
sbx secret set github                 # the value, first
sbx secret set mistral                # ...and your provider's
sbx create --name myproject ./kit     # approve the credential prompts
sbx run --name myproject              # start it; Ctrl-\ detaches
```

⚠️ `sbx create` does **not** start the workload — it prints `try: sbx run --name
<name>` and stops there. The sandbox shows as running, the published port
accepts connections and immediately resets, and nothing serves. Approving a
credential with no stored secret binds nothing, which is why the approval
prompt can be followed by `no binding authorizes this service`.

After that `t3-code-kit up myproject` reuses the binding.

## Manual setup on the host

The kit automates the sandbox. Everything below is the host's, and cannot be
scripted: each step is a secret or an approval, and `sbx` deliberately refuses
to make those non-interactively. Skipping one does not fail loudly — it fails
as a withheld credential or a stale model list.

### Once per host

| Step | Why | Verify |
|---|---|---|
| `sbx login` | Docker OAuth; no sandbox runs without it | `sbx ls` |
| `sbx secret set github` | the value git pushes with; the sandbox only ever sees a sentinel | `sbx secret ls` |
| `sbx secret set <provider>` (default `mistral`) | pi's model key | `sbx secret ls` |
| Approve the credential binding | a stored secret is **not** an approval | see below |

**The binding is the step that bites.** `sbx` records which kit may use which
service and domain in `%APPDATA%\sbx\credentials.yaml`, and only asks
interactively. The launcher creates sandboxes detached, so the first one starts
with the credential withheld. Either create the first sandbox by hand and
answer the prompt:

```powershell
sbx create --name myproject -p 127.0.0.1:3773:3773 .\kit   # approve when asked
sbx run -d --name myproject
```

or write the binding yourself — this is the whole file, and the domains must
match the kit's `inject` rules and its egress allowlist:

```yaml
bindings:
  github:
    apiKey:
      domains: [api.github.com, github.com]
  mistral:
    apiKey:
      domains: [api.mistral.ai]
```

A malformed file breaks every `sbx` command, so delete it and re-approve rather
than hand-fixing it.

### Once per host, if port 3773 is taken

Another sandbox on 3773 (including one running a T3 Code session) wins. Pick a
host port for the kit:

```powershell
$env:T3CK_PORT = 3774
```

### Once, if you cloned before `.gitattributes` existed

```powershell
git rm --cached -r . | Out-Null; git reset --hard
```

Otherwise `kit/serve.sh` stays CRLF and the server never starts.

### In the t3 UI, once per provider

- Add or enable a **pi provider instance**. The kit installs pi and starts t3;
  it does not create t3's provider records.
- Refresh its model list from provider settings (`server.refreshProviders`).
  This is t3's own state in `statev2.sqlite` and the one cache a shell cannot
  reach — `t3-code-kit refresh` covers the other two.

### Nothing else is required

No Docker Desktop, no Docker Engine, no bash on Windows. The one prerequisite
on Windows is PowerShell 7 (`winget install Microsoft.PowerShell`) — Windows
PowerShell 5.1 is not supported. If you exported `SBX_KIT_BUILDER` yourself at
some point, unset it: the launchers default to the builder sandbox, and `host`
fails on a machine without a running Buildx.

## Install

macOS / Linux:

```sh
git clone https://github.com/juranki/t3-code-kit
ln -s "$PWD/t3-code-kit/bin/t3-code-kit" ~/.local/bin/t3-code-kit
```

Windows (no bash needed — `bin/t3-code-kit.ps1` is a PowerShell 7 port, so it
needs PowerShell 7 installed but no WSL and no bash):

```powershell
winget install Microsoft.PowerShell
git clone https://github.com/juranki/t3-code-kit
# then, from the repo:
.\bin\t3-code-kit.ps1 up myproject
```

Optionally put `bin` on `PATH` and drop the `.ps1`. No installer, no package.
It is a launcher, a Dockerfile, and a descriptor.

⚠️ The two launchers are deliberate duplicates — `bin/t3-code-kit` (POSIX sh)
and `bin/t3-code-kit.ps1` (PowerShell) — because the alternative is telling a
Windows user to install bash. They can drift; `bin/smoke` and `bin/smoke.ps1`
cover the same ground, so run whichever matches your host.

## Use

```sh
t3-code-kit up myproject     # create, publish the port, print the pairing URL
```

`up` uses `sbx create`, not `sbx run`: `run` always bind-mounts a workspace, and
with no path argument it mounts the current directory. `create` with no path is
the mountless form, which is what keeps the host filesystem out of reach.

Open the printed `http://localhost:3773/pair#token=…` in your browser. That is
the whole workflow: the t3 web UI runs in the sandbox, and pi is one of the
agents it can drive.

⚠️ `up` on an existing sandbox **reuses the image it was created from**. After
changing anything under `kit/`, use `rebuild` — otherwise you are restarting a
sandbox that still contains the old image, and the fix you just pulled is not in
it.

```sh
t3-code-kit url myproject    # mint a fresh pairing URL
t3-code-kit logs myproject   # tail the server log inside the sandbox
t3-code-kit shell myproject  # bash inside the sandbox
t3-code-kit refresh myproject # restart, which also refreshes the catalog
 t3-code-kit down myproject   # stop; repos and threads survive
t3-code-kit rebuild myproject # recreate, forcing a Kit image rebuild
t3-code-kit nuke myproject   # destroy the sandbox and its volumes
t3-code-kit policy           # print the runtime egress allowlist
```

One sandbox per project. `T3CK_NAME` sets the default name, `T3CK_PORT` the
host port (3773).

## What ships

| Path | What it is |
|---|---|
| [`kit/t3-code.yaml`](kit/t3-code.yaml) | The [Kit v3](https://github.com/docker/sandbox-kit-spec) descriptor: port, volumes, credential, egress policy, agent context |
| [`kit/t3-code.dockerfile`](kit/t3-code.dockerfile) | The content: t3, pi, and the skills (the pins are build args) |
| [`kit/skills.txt`](kit/skills.txt) | The skills baked into the image, one per line |
| [`kit/skills.sh`](kit/skills.sh) | The one parser for `kit/skills.txt`: names for the build, count for the checks |
| [`kit/serve.sh`](kit/serve.sh) | `t3 serve` with its output mirrored to a log file; started by the Kit's `lifecycle@1` startup hook |
| [`policy/allow.txt`](policy/allow.txt) | Readable mirror of the runtime egress list |
| [`policy/install.txt`](policy/install.txt) | Readable mirror of the build-time egress list |
| [`bin/t3-code-kit`](bin/t3-code-kit) | The launcher: eight verbs over `sbx` (POSIX sh) |
| [`bin/t3-code-kit.ps1`](bin/t3-code-kit.ps1) | The same launcher for a Windows host (PowerShell 7+) |
| [`bin/smoke`](bin/smoke) · [`bin/smoke.ps1`](bin/smoke.ps1) | The acceptance test — this is what "it works" means |
| [`prototype/spike.md`](prototype/spike.md) | What was verified before any of this was written |

The descriptor is normative. A Kit carries its authority in the image, under
one digest, so the egress lists live there; `policy/allow.txt` (runtime) and
`policy/install.txt` (build time) are the copies you read, and `bin/smoke`
fails if any of them disagrees with the descriptor. They are separate files on
purpose: `t3-code-kit policy` prints only the runtime one, so a build-time host
listed there would read as a runtime permission.

## Skills

The agent workflow these docs describe — `/triage`, `/code-review`,
`/grill-with-docs`, `/wayfinder` — is **baked into the image**, at
`/home/agent/.agents/skills`. The build adds it from
[`mattpocock/skills`](https://github.com/mattpocock/skills), pinned twice:
`SKILLS_REF` to a commit, `SKILLS_VERSION` to a CLI version. The selection
lives in [`kit/skills.txt`](kit/skills.txt) — 27 of the repo's 38; the rest are
in-progress writing experiments and Claude-specific one-offs.

Changing them is a `rebuild`, not an in-sandbox change:

```sh
t3-code-kit rebuild myproject
```

Bump `SKILLS_REF` (and `SKILLS_VERSION` if the CLI moved) in
[`kit/t3-code.dockerfile`](kit/t3-code.dockerfile) first. A `skills add` you run
by hand inside a sandbox is wiped by the next rebuild, and a name in
`kit/skills.txt` that no longer exists upstream fails the build rather than
silently shrinking the set. Why baked in and not a volume: [ADR
0001](docs/adr/0001-skills-baked-into-image.md).

## Toolchains

The image bakes a default dev toolchain with [`mise`](https://mise.jdx.dev):
node, go, and python, at the versions in the `nodeVersion`, `goVersion`, and
`pythonVersion` kit args. mise comes from the base image's apt source, not a
`curl | sh` installer. Its shims are first on the image's `PATH`, so a
non-interactive shell — which is what the agent's bash tool runs — resolves
`node`, `go`, and `python` through mise, with no shell rc file and no
`mise activate`.

A repo records what it needs in `.mise.toml` at its root:

```toml
[tools]
node = "22.23.4"
python = "3.13.18"
```

mise reads that from the repo under `/home/agent/workspace`, and the project
config wins over the image's global default. What is *installed* is still the
baked set: the build cannot see the repo, so a `.mise.toml` alone changes which
version mise selects, not which versions exist. To get a different one, set the
matching kit arg (and pin it in `.mise.toml`) and rebuild:

```sh
t3-code-kit rebuild myproject
```

To bump the baked default, change the `nodeVersion` / `goVersion` /
`pythonVersion` defaults in [`kit/t3-code.yaml`](kit/t3-code.yaml) (and the
matching `ARG` in the Dockerfile) the same way `t3Version` and `piVersion` are
bumped, then rebuild.

Java is not mise's: the image appends the base image's OpenJDK 21 to `PATH`,
and `mise-java` is deliberately not allowed.

⚠️ **A 403 during a toolchain install is an allowlist line, not a broken
network.** The build-time hosts are in the descriptor's `install.allow` (and
[`policy/install.txt`](policy/install.txt)); `runtime.allow` deliberately does
not carry them, so an on-demand `mise install` inside a running sandbox is
refused.

## Verify

```sh
bin/smoke            # macOS / Linux
.\bin\smoke.ps1      # Windows
```

Checks the static files, brings a sandbox up, waits for the server, mints a
pairing URL, and proves the toolchain, the volume, and GitHub egress. Set
`SMOKE_DOWN=1` to stop the sandbox afterwards.

The pi round-trip is **off by default** — it spends real model tokens, and it
currently fails for a reason outside this repo: pi hangs under a non-TTY
`sbx exec` and only answers interactively. Run it with `SMOKE_AGENT=1`; it is
killed after `SMOKE_AGENT_TIMEOUT` seconds (120) so a wedged pi fails the check
rather than blocking the run.

## Limits

- ⚠️ **The published port is host-local.** `sbx` binds `127.0.0.1` on the host
  by design, so the browser must be on the same machine. Remote access needs an
  SSH tunnel; `--tailscale-serve` will not work inside a sandbox (sbx blocks
  UDP and proxies TCP).
- ⚠️ **`nuke` is the only verb that destroys data**, and it destroys all of it.
- ⚠️ **Kits v3 is Early Access and the spec is experimental** (a final version
  is targeted for Q4 2026). The kit descriptor, the base image reference, and
  the `sbx` verbs are the parts most likely to move under you.
- ⚠️ **No self-update inside the sandbox.** t3 and the skills are pinned as
  build args; pi defaults to `latest`. Bumping any of them is a `rebuild`.
- ⚠️ **One provider ships in v1** (pi). Adding another is one Dockerfile block,
  one credential, and one egress entry.
- ⚠️ **GitHub is the only git host wired in.** t3 itself supports Bitbucket,
  GitLab, and Gitea/Codeberg too, but the Kit ships one credential and one
  host's allowlist entries; adding another is the same kind of three-part change
  as adding a provider — a credential, its `inject` rule, and its runtime
  allowlist entry. Until then a `403` on that host is a policy decision, not a
  broken network.
- ⚠️ **Not verified end to end on a host yet.** See
  [`prototype/spike.md`](prototype/spike.md) for exactly which claims are proven
  and which are not.

## Troubleshooting

**The model list is stale, or missing models that exist.** Every start of the
sandbox attempts to refresh the catalog: `kit/serve.sh` runs
`pi update --models` best-effort and clears t3's cached `model-manifest.json`
before `t3 serve`.
Restart to force it: `t3-code-kit refresh <name>` (or `down` then `up`). The
refresh is best-effort — a blocked or slow `pi.dev` is logged in
`/home/agent/.t3/serve.log` and the sandbox falls back to the catalog baked
into the image, which ages. If the provider record in the UI still shows the
old list, refresh it there — t3 exposes that as `server.refreshProviders` in
provider settings. A model list that is stale *after* a restart is a t3
caching issue, not the sandbox.

t3 fetches its model manifest from `raw.githubusercontent.com` and pi checks
its catalog on `pi.dev`; both are in the allowlist for that reason. Check with
`sbx exec <name> -- curl -sI https://raw.githubusercontent.com/ | head -1`.

**The terminal in the UI has no history, no completion, and no colors.** t3
spawns that terminal from the server's `$SHELL`, and the platform starts the
workload with `SHELL=/bin/sh` — which is dash: no readline, so no history and
no tab completion, and a prompt that never reads `~/.bashrc`. `kit/serve.sh`
exports `/bin/bash` for exactly this reason, so a sandbox built before that
line existed needs a `rebuild`; `bin/smoke` reads the running server's
environment and fails if it is not bash.

**The provider answers `401 Invalid API Key` and the sandbox has
`MISTRAL_API_KEY=proxy-managed`.** The credential has no `inject` rule, so the
proxy has nothing to swap the sentinel *for*. `inject` names the domain and
header the key belongs in; its `domain` cannot be a kit arg, so switching
provider means editing `provider`, `providerApiKeyEnv`, and the `inject` block
in `kit/t3-code.yaml` together — and approving the new domain's binding.

**An agent says it cannot reach an API.** Egress is deny-by-default and the
proxy does not fail like a network. It answers:

```
Approval required for api.example.com:443.
Review and respond with: sbx policy approval ls
```

Add the host to `kit/t3-code.yaml` (`network-policy@2`, `runtime.allow`) and to
`policy/allow.txt`, then `t3-code-kit rebuild`.

**The pairing URL does not open.** `t3 serve` prints the sandbox's outbound
interface address, which the host cannot reach; the launcher rewrites it to
`http://localhost:<port>`. If `up` printed nothing, run `t3-code-kit logs`.

**The Kit build fails with `dockerDesktopLinuxEngine: The system cannot find the
file`.** `sbx` tried the host's Docker Buildx. The launchers default to
`SBX_KIT_BUILDER=sandbox`; if you exported `SBX_KIT_BUILDER` yourself, unset it.

**The Kit build fails with `OCI exporter is not supported for the docker
driver`.** Same cause — the host Buildx driver cannot emit the OCI layout a Kit
needs. Use the builder sandbox: `$env:SBX_KIT_BUILDER = 'sandbox'`.

**The sandbox starts but the server never answers, and there is no
`/home/agent/.t3/serve.log`.** Nothing started the server. The kit declares
`sbx@1` and starts `serve.sh` from a `lifecycle@1` startup hook, because the
image entrypoint is not what runs a workload on the agent platform. If you are
editing the kit, keep the hook's `env` list complete: a hook sees only the
variables it declares, and a missing `HTTPS_PROXY` silently breaks all egress. The usual cause on
Windows is CRLF: a clone with `core.autocrlf=true` rewrites `kit/serve.sh`, so
the shebang becomes `#!/usr/bin/env bash\r` and it fails to exec silently.
`.gitattributes` forces LF and the Dockerfile strips CR, but an existing clone
needs re-checking out:

```powershell
git pull
git rm --cached -r . | Out-Null; git reset --hard
```

**`capability com.docker.sandbox/<type>: json: unknown field "<field>"`.** The
descriptor used a field newer than your `sbx` build. The spec is experimental
and fields land between releases — `port@1`'s `family` arrived 2026-10-26, for
instance. Check the field's date in the
[spec repo history](https://github.com/docker/sandbox-kit-spec/commits/main/schema)
and drop it; everything this kit uses otherwise dates from the initial release.

**`t3: No such file or directory` inside the sandbox.** `/home/agent/.local/bin/t3`
is a symlink into `$T3CODE_HOME/runtime/versions/<v>/t3`. If someone volumes all
of `/home/agent/.t3`, the volume shadows that install and the symlink dangles.
The kit volumes only `userdata`, `projects`, and `worktrees`.

**The sandbox will not start.** Check `sbx ls`, then `sbx diagnose`. A Kit that
fails to build usually means the base image reference moved — it is the `BASE`
arg at the top of `kit/t3-code.dockerfile`.

## License

MIT
