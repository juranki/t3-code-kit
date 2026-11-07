# Toolchains

What the image bakes, how a repo selects a version, and why a toolchain install
can fail with a `403`. The README keeps the summary; this is the reference.

## The baked set

The image bakes node, go, and python with [`mise`](https://mise.jdx.dev), at the
`nodeVersion`, `goVersion`, and `pythonVersion` kit args. mise comes from the
base image's apt source, not from a `curl | sh` installer.

**Python stays on the 3.13 line, pinned to 3.13.18.** The decision in
[#80](https://github.com/juranki/t3-code-kit/issues/80) keeps compatibility with
repos already pinning 3.13. No package in this workspace uses Python, and there
is no requirement for a newer line to justify changing that default.

mise's shims are first on the image's `PATH`. A non-interactive shell resolves
`node`, `go`, and `python` through them, and that is what the agent's bash tool
runs. No shell rc file is read, and nothing calls `mise activate`.

Three more tools are baked without mise:

- **Vite+** (`vp`) is a global npm install at the `vitePlusVersion` pin. The v2
  workspace runs its tests, lint, and format through it.
- **fd** is a pinned release binary in `/usr/local/bin`, at the `fdVersion` pin.
  pi finds it on `PATH` and skips its own first-run download.
- **Codex** (`codex`) is a global npm install at the `codexVersion` pin. t3
  finds it on `PATH` and starts its app-server; without the bake, t3 would
  download a managed runtime into `$T3CODE_HOME/tools` on first use, which a
  `rebuild` throws away.

Bumping any of them is a `rebuild`. `rg` is the base image's, not the kit's: the
kit does not pin it.

## Pinning a repo's toolchain

A repo records what it needs in `.mise.toml` at its root:

```toml
[tools]
node = "26.13.0"
python = "3.13.18"
```

mise reads that file from the repo under `/home/agent/workspace`. The project
config wins over the image's global default.

What is _installed_ is still the baked set. The build cannot see the repo, so a
`.mise.toml` changes which version mise selects, not which versions exist. To
get a different one, set the matching kit arg, pin it in `.mise.toml`, and
rebuild:

```sh
npm run rebuild -- myproject
```

⚠️ **The baked node is the only node.** The build installs exactly one version,
so a repo whose `.mise.toml` asks for a different line gets a resolution mise
cannot satisfy. Change `nodeVersion` (and `NODE_VERSION`) and rebuild. The kit
does not bake a second line.

**The baked Python is the only Python.** A repo whose `.mise.toml` pins another
line, such as 3.14 or 3.15, will not resolve against the default image. A
different exact patch also needs to be baked in. Change `pythonVersion` in the
descriptor and `PYTHON_VERSION` in the Dockerfile to match the repo's pin, then
rebuild. Runtime toolchain installs are blocked by the network policy.

## T3's preview browser

`html_preview` and `html_render` drive a `chrome-headless-shell`. t3 downloads
that binary on first render from `storage.googleapis.com`, a host the runtime
policy refuses. A fresh sandbox would therefore never render.

So the image pre-seeds it, at the path t3 looks in:
`$T3CODE_HOME/tools/chrome-headless-shell/<platform>/<version>/`. It also bakes
the 18 packages the binary needs: 16 libraries plus `fontconfig` and
`fonts-liberation`.

The pin is `CHROME_VERSION`, a plain `ARG` and deliberately not a kit arg. It
has to track the t3 binary. That way a `T3_VERSION` bump which moves the Chrome
pin fails the build, instead of leaving a binary t3 ignores.

The build also asserts that `ldd` resolves every library and that the binary
starts. A wrong package name then fails the layer, not the smoke.

## Bumping a pin

Change the `nodeVersion` / `goVersion` / `pythonVersion` / `vitePlusVersion` /
`fdVersion` / `codexVersion` defaults in
[`kit/t3-code.yaml`](../kit/t3-code.yaml), and the matching `ARG` in the
Dockerfile. Bump them the same way `t3Version` and `piVersion` are bumped, then
rebuild.

## Java

Java is not mise's. The image appends the base image's OpenJDK 21 to `PATH`, and
`mise-java` is deliberately not allowed.

## A `403` during a toolchain install

⚠️ **A 403 during a toolchain install is an allowlist line, not a broken
network.** The build-time hosts are in the descriptor's `install.allow`, and in
[`policy/install.txt`](../policy/install.txt) as a readable copy.

`runtime.allow` deliberately does not carry them. An on-demand `mise install`
inside a running sandbox is therefore refused.
