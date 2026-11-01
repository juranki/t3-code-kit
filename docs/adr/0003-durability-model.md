# `nuke` destroys volume contents, not volumes

`nuke` has always promised to destroy a sandbox's volumes, and it has always
destroyed nothing: `sbx rm --force` keeps persistent volume storage, so every
repo and all t3 state came back on the next `up` with the same name. `rebuild`
made the opposite claim and, for the same reason, was telling the truth — it
keeps `.t3` state. So `rebuild` keeps its promise and its wording is corrected;
`nuke` keeps its promise by wiping the volume _contents_ from inside the
sandbox before removing the instance. The volume _objects_ stay allocated,
because `sbx` has no per-sandbox purge, and the next `create` reattaches them
empty.

## The evidence, and the version it holds for

Verified against **`sbx` v0.50.1 (`ddb0268d7124b9cf98955d0b08ffd71a0dfcebe4`)**
on Windows 11 x64, `sbx.exe`, 2026-11-01. The full capture is on the throwaway
branch `probe/sbx-capabilities` at
[`docs/research/sbx-probe-2026-11-01.log`](https://github.com/juranki/t3-code-kit/blob/probe/sbx-capabilities/docs/research/sbx-probe-2026-11-01.log).

| volume            | survives `stop` | survives `rm --force` + `create` | purgeable locally |
| ----------------- | --------------- | -------------------------------- | ----------------- |
| `workspace`       | yes             | yes                              | no                |
| `.t3/userdata`    | yes             | yes                              | no                |
| `.t3/projects`    | yes             | yes                              | no                |
| `.t3/worktrees`   | yes             | yes                              | no                |

Same `.sbx-volume-initialized` timestamp and same backing device
(`/dev/vde`–`/dev/vdh`) in every phase, so these are the same volumes
reattaching, not fresh ones. No cell is unknown.

**The retention is conditional in `sbx`'s own words.** `sbx rm --help` says
"persistent volume@1 storage **created with retention support** are kept;
creating the same sandbox name with the same kit reattaches its persistent
volumes." That is why the version is pinned above: this is a property of
v0.50.1, not of `sbx` in general.

There is no local purge to call instead. `sbx volume` is cloud-only ("volume
commands require --cloud"), `sbx --cloud volume` fails without a Docker Agentic
Platform subscription, and `sbx rm` has no `--purge` or `--volumes`. The one
local purge, `sbx reset`, resets the whole installation — every sandbox, every
policy, every stored secret, the Docker sign-in, the daemon — and its only
scoping flag, `--preserve-secrets`, scopes to secrets rather than to a sandbox.
`nuke <name>` therefore cannot use it: it would destroy every other sandbox to
clean one.

One cell is deliberately unverified: whether `sbx reset`'s "delete all sandbox
state" covers `volume@1` storage. The only way to find out is to run it on a
real host, which destroys every sandbox and the credential store there. It does
not change this decision, because `nuke` cannot call `reset` either way.

## The decision

**`rebuild`** keeps durable state. It is `rm --force` + `create` and that is
enough; no export/import, no host-side copy. Its message becomes "recreating
'<name>' from a freshly built image; repos and t3 state survive on their
volumes." It takes no flags.

**`nuke`** destroys durable state, then removes the instance:

1. **Confirm.** On a TTY, prompt for the sandbox name. On a non-TTY, require
   `--yes` and exit 2 without touching anything if it is absent. `sbx rm`
   already asks this and the kit already suppresses it with `--force`, so the
   kit restores the check at the layer that knows a wipe is coming.
2. **Wipe.** One `sbx exec` running `sh -c`: kill `t3 serve` and `pi`, then
   `find <dir> -mindepth 1 -delete` in each of the four mountpoints. `sbx exec`
   starts a stopped sandbox, which runs the `lifecycle@1` hook and starts
   `t3 serve`, so the kill is not optional — otherwise the wipe races a live
   SQLite writer. `find -delete` rather than `rm -rf dir/*`, which misses
   dotfiles.
3. **Verify.** Re-read for a marker; retry the wipe once. If a marker survives
   both attempts, **abort before `rm --force`** and exit 1. Removing the
   instance after a failed wipe is the worst outcome available: the data is
   intact, the user has been told it is gone, and there is no longer an
   instance to wipe it from.
4. **Remove.** `sbx rm --force <name>`. This also deletes secrets scoped to the
   sandbox, per `rm --help`.
5. **Say what remains.** "done. '<name>' is gone; its volume storage stays
   allocated, empty — sbx has no per-sandbox purge."

**`nuke` on a name with no instance** fails (exit 1) rather than succeeding.
There is no local way to see whether volumes exist, so the kit cannot tell
"never created" from "instance removed, data still on disk", and the second is
exactly the case where a silent success leaves data the user believes
destroyed. The message names the remedy: `up <name>` then `nuke <name>`.

**Durable state** means the contents of those four volumes and nothing else.
`~/.pi/agent`, `~/.cache`, `~/.npm`, and the image cache are not durable state;
`rm` discards them as a side effect, and promising to wipe them would be
describing `sbx`, not the kit.

## Considered Options

**Export/import `.t3` across the recreate — rejected as unnecessary.** It was
the only way to keep state under the assumption that `rm --force` destroys
volumes. It does not, on v0.50.1, so the copy would buy nothing and would cost
either a host temp dir (t3 state on the host, which is what the kit exists to
avoid) or a dependency on `workspace` reattaching, which nothing in `volume@1`
promises.

**Stop claiming: `nuke` becomes `down --forget` — rejected.** Honest about the
mechanism and wrong about the outcome. A user who nukes to shed a leaked token
in `workspace` would get it back on the next `up`.

**`nuke --purge`, with today's behaviour as the default — rejected.** It leaves
the default lying, which is the bug. The residual — allocated-but-empty volume
objects — is invisible to the user, so it belongs in one line of output, not in
a flag.

**`rebuild --reset-state`, or `nuke --keep-state` — rejected.** One verb per
durability outcome: `down` stops and keeps state, `rebuild` recreates from a
fresh image and keeps state, `nuke` destroys state and removes the instance.
Clean-slate is `nuke` then `up`. Every flag here reintroduces the ambiguity that
produced the false README row.

**`sbx reset` — rejected on blast radius.** It is the only local purge and it
resets the whole installation.

**Upstream: ask `sbx` for a per-sandbox purge — deferred, not rejected.** It is
the only route to reclaiming the storage, and the only route to a `nuke` that
removes volume objects rather than emptying them. If it appears, `nuke` should
call it and the wipe becomes the fallback for older versions. Until then the
wipe is the promise.

## Consequences

- **The `Sbx` seam does not grow a local `volumes` method.** There is no local
  volume CLI to wrap; a volumes capability is cloud-only and out of scope.
  `nuke` needs `exec`, `rm`, and enough of `list` to know whether the instance
  exists.
- **Retention is load-bearing for `rebuild` and adversarial for `nuke`.** If a
  future `sbx` drops it, `rebuild` silently starts losing state and `nuke`
  becomes correct by accident. The guard is the `rebuild` smoke assertion — a
  marker written to `.t3/userdata` and `workspace`, rebuilt, read back — not a
  version check. Smoke prints `sbx version` so a failure is attributable.
- **`nuke` cannot reclaim disk.** A nuked sandbox leaves its storage allocated
  until `sbx` grows a per-sandbox purge.
- **The README and both launchers are wrong until the port lands.** `nuke`'s
  current message and the README's "Survives `nuke` | nothing" are false today;
  the corrected wording ships with the port, so the repo never claims a
  behaviour the code does not have.
- **Smoke gains four assertions:** the `rebuild` marker round-trip; `nuke` then
  `up` the same name leaves all four volumes empty and `workspace` with no
  entries at all; `nuke` on a missing instance exits non-zero; `nuke` without
  `--yes` on a non-TTY exits non-zero and removes nothing.
