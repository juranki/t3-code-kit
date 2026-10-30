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
| Survives `stop` / restart | repos, t3 threads, worktrees — they live on volumes |
| Survives `nuke` | nothing |

⚠️ This is a *containment* boundary, not a convenience wrapper. If you want to
edit the same files in your editor and in the agent's sandbox, this kit is the
wrong tool — it deliberately gives you no host mount.

## Requirements

- [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/install/) (`sbx`) on
  the host: macOS 14+ on Apple silicon, Windows 11 x64, or Ubuntu 24.04+ with
  KVM. `sbx login` once.
- A GitHub credential in the sandbox credential store:
  `sbx secret set github`
- A model provider key for pi, likewise: `sbx secret set <provider>`

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

Open the printed `http://localhost:3773/pair#token=…` in your browser. That is
the whole workflow: the t3 web UI runs in the sandbox, and pi is one of the
agents it can drive.

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
| [`kit/serve.sh`](kit/serve.sh) | Entrypoint — `t3 serve` with its output mirrored to a log file |
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

**The sandbox will not start.** Check `sbx ls`, then `sbx diagnose`. A Kit that
fails to build usually means the base image reference moved — it is the `BASE`
arg at the top of `kit/t3-code.dockerfile`.

## License

MIT
