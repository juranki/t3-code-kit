# Toolchains

What the image bakes, how a repo selects a version, and why a toolchain install
can fail with a `403`. The README keeps the summary; this is the reference.

## The baked set

The image bakes a default dev toolchain with [`mise`](https://mise.jdx.dev):
node, go, and python, at the versions in the `nodeVersion`, `goVersion`, and
`pythonVersion` kit args. mise comes from the base image's apt source, not a
`curl | sh` installer. Its shims are first on the image's `PATH`, so a
non-interactive shell — which is what the agent's bash tool runs — resolves
`node`, `go`, and `python` through mise, with no shell rc file and no
`mise activate`.

Two more tools are baked without mise:

- **Vite+** (`vp`) is a global npm install at the `vitePlusVersion` pin, because
  the v2 workspace runs its tests, lint, and format through `vp`.
- **fd** is a pinned release binary in `/usr/local/bin` at the `fdVersion` pin,
  so pi finds it on `PATH` and skips its own first-run download.

Bumping either is a `rebuild`, the same as the mise toolchain. `rg` is the base
image's, not the kit's: the kit does not pin it.

## Pinning a repo's toolchain

A repo records what it needs in `.mise.toml` at its root:

```toml
[tools]
node = "26.13.0"
python = "3.13.18"
```

mise reads that from the repo under `/home/agent/workspace`, and the project
config wins over the image's global default. What is _installed_ is still the
baked set: the build cannot see the repo, so a `.mise.toml` alone changes which
version mise selects, not which versions exist. To get a different one, set the
matching kit arg (and pin it in `.mise.toml`) and rebuild:

```sh
npm run rebuild -- myproject
```

⚠️ **The baked node is the only node.** A repo whose `.mise.toml` asks for a
different line gets a resolution mise cannot satisfy, because the build
installs exactly one version. Change `nodeVersion` (and `NODE_VERSION`) and
rebuild; the kit does not bake a second line.

## T3's preview browser

**T3's preview browser is baked too.** `html_preview` and `html_render` drive a
`chrome-headless-shell`, and t3 downloads it on first render from
`storage.googleapis.com` — a host the runtime policy refuses, so a fresh
sandbox would never render. The image pre-seeds the binary at the path t3 looks
in (`$T3CODE_HOME/tools/chrome-headless-shell/<platform>/<version>/`) together
with the 18 packages it needs: 16 libraries plus `fontconfig` and
`fonts-liberation`. The pin is `CHROME_VERSION`, a plain `ARG` and deliberately
not a kit arg: it has to track the t3 binary, so a `T3_VERSION` bump that moves
the Chrome pin fails the build instead of leaving a binary t3 ignores. The
build also asserts that `ldd` resolves every library and that the binary
starts, so a wrong package name fails the layer rather than the smoke.

## Bumping a pin

To bump the baked default, change the `nodeVersion` / `goVersion` /
`pythonVersion` / `vitePlusVersion` / `fdVersion` defaults in
[`kit/t3-code.yaml`](../kit/t3-code.yaml) (and the matching `ARG` in the
Dockerfile) the same way `t3Version` and `piVersion` are bumped, then rebuild.

## Java

Java is not mise's: the image appends the base image's OpenJDK 21 to `PATH`,
and `mise-java` is deliberately not allowed.

## A `403` during a toolchain install

⚠️ **A 403 during a toolchain install is an allowlist line, not a broken
network.** The build-time hosts are in the descriptor's `install.allow` (and
[`policy/install.txt`](../policy/install.txt)); `runtime.allow` deliberately
does not carry them, so an on-demand `mise install` inside a running sandbox is
refused.
