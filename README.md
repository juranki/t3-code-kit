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

## Install

macOS / Linux:

```sh
git clone https://github.com/juranki/t3-code-kit
ln -s "$PWD/t3-code-kit/bin/t3-code-kit" ~/.local/bin/t3-code-kit
```

Windows (no bash needed — `bin/t3-code-kit.ps1` is a Windows PowerShell 5.1
port, so a stock Windows 11 runs it as-is):

```powershell
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
| [`kit/t3-code.dockerfile`](kit/t3-code.dockerfile) | The content: t3 and pi, pinned |
| [`kit/serve.sh`](kit/serve.sh) | `t3 serve` with its output mirrored to a log file; started by the Kit's `lifecycle@1` startup hook |
| [`policy/allow.txt`](policy/allow.txt) | Readable mirror of the runtime egress list |
| [`bin/t3-code-kit`](bin/t3-code-kit) | The launcher: eight verbs over `sbx` (POSIX sh) |
| [`bin/t3-code-kit.ps1`](bin/t3-code-kit.ps1) | The same launcher for a Windows host (PowerShell 5.1+) |
| [`bin/smoke`](bin/smoke) · [`bin/smoke.ps1`](bin/smoke.ps1) | The acceptance test — this is what "it works" means |
| [`prototype/spike.md`](prototype/spike.md) | What was verified before any of this was written |

The descriptor is normative. A Kit carries its authority in the image, under
one digest, so the egress list lives there; `policy/allow.txt` is the copy you
read, and `bin/smoke` fails if the two disagree.

## Verify

```sh
bin/smoke            # macOS / Linux
.\bin\smoke.ps1      # Windows
```

Checks the static files, brings a sandbox up, waits for the server, mints a
pairing URL, and proves the toolchain, the volume, GitHub egress, and one pi
round-trip. Set `SMOKE_SKIP_AGENT=1` to skip the model call, `SMOKE_DOWN=1` to
stop the sandbox afterwards.

## Limits

- ⚠️ **The published port is host-local.** `sbx` binds `127.0.0.1` on the host
  by design, so the browser must be on the same machine. Remote access needs an
  SSH tunnel; `--tailscale-serve` will not work inside a sandbox (sbx blocks
  UDP and proxies TCP).
- ⚠️ **`nuke` is the only verb that destroys data**, and it destroys all of it.
- ⚠️ **Kits v3 is Early Access and the spec is experimental** (a final version
  is targeted for Q4 2026). The kit descriptor, the base image reference, and
  the `sbx` verbs are the parts most likely to move under you.
- ⚠️ **No self-update inside the sandbox.** t3 and pi are pinned as build args;
  bumping is a `rebuild`.
- ⚠️ **One provider ships in v1** (pi). Adding another is one Dockerfile block,
  one credential, and one egress entry.
- ⚠️ **Not verified end to end on a host yet.** See
  [`prototype/spike.md`](prototype/spike.md) for exactly which claims are proven
  and which are not.

## Troubleshooting

**The model list is stale, or missing models that exist.** t3 fetches its model
manifest from `raw.githubusercontent.com` and pi checks its catalog on
`pi.dev`; both are in the allowlist for that reason. A blocked fetch is silent
— t3 falls back to the manifest bundled in the image, which ages. Check with
`sbx exec <name> -- curl -sI https://raw.githubusercontent.com/ | head -1`.

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
