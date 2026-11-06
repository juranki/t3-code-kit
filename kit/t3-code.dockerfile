# syntax=docker/dockerfile:1

# The sandbox platform floor — bash, the non-root `agent` user (uid 1000), git,
# a CA store — comes from Docker's template images. A bare distro builds fine
# and then fails at agent launch with a missing /bin/bash.
#
# Verified to pull anonymously and to carry: agent (uid 1000), bash, git,
# curl, node 24, npm, gh, and /home/agent/workspace. Swapping the base should
# stay a one-line change.
ARG BASE=dhi.io/sbx-templates:claude-code-docker
FROM ${BASE}

# Pinned on purpose: nothing self-updates inside the sandbox. Bumping is a
# `npm run rebuild`.
ARG T3_VERSION=0.1.7
ARG PI_VERSION=latest
ARG CODEX_VERSION=0.166.0

# The baked mise toolchain. These are mise versions, not image tags: bumping
# one is a `rebuild`, the same as T3_VERSION and PI_VERSION. Java is
# deliberately not here — it is the base image's OpenJDK 21, put on PATH below.
#
# Node is the v2 workspace's exact pin (package.json engines.node), so the
# repo and the image cannot drift.
ARG NODE_VERSION=26.13.0
ARG GO_VERSION=1.25.14
ARG PYTHON_VERSION=3.13.18

# Vite+ is the v2 workspace's test/lint/format runner. A global npm install,
# not a mise tool: mise has no vite-plus plugin, and the npm backend would only
# add a second install path. The pin matches package.json's devDependency.
ARG VITE_PLUS_VERSION=1.5.0

# fd is pinned because pi otherwise downloads it into ~/.pi/agent/bin on its
# first run (#25): a runtime install, a first-run stall, and a binary a rebuild
# throws away. The release tarball comes from github.com and
# objects.githubusercontent.com, both already in install.allow.
ARG FD_VERSION=10.5.0

# The skills pin is a commit, not a branch, and that is load-bearing: with a
# ref set the `skills` CLI clones at that sha instead of asking api.github.com
# for a repository tree, so this step reaches only github.com and
# registry.npmjs.org — no new install-time host in network-policy@2. Verified
# with api.github.com blackholed: same 27 skills, byte-identical, hashes
# computed locally.
ARG SKILLS_VERSION=1.7.4
ARG SKILLS_REF=a496f5513d4a4cf889bc48e189e579f4b0bdf6aa

# t3 ships prebuilt native modules that link libatomic. mise is the toolchain
# manager, and it comes from the base image's apt source — no installer script
# and no new egress.
#
# The rest of the list is T3's preview browser: `html_preview` and `html_render`
# drive a chrome-headless-shell that needs 20 shared libraries this hardened
# base image does not carry (24 unresolved `ldd` entries; the 16 library
# packages below ship more than one .so each). The list is T3's own
# DEBIAN_PACKAGES minus libnss3 and libexpat1 (already here) plus libnspr4.
# libnspr4 is named explicitly on purpose: T3 relies on libnss3 pulling it in,
# and DHI ships libnss3 stripped of that dependency, so setup leaves
# libnspr4.so, libplc4.so and libplds4.so missing. fontconfig and
# fonts-liberation are what make text render at all — without them a preview is
# blank boxes, not a page. libgbm1 is not optional either: it is in the
# unresolved `ldd` set, and it drags in mesa-libgallium and libllvm19, which is
# ~170 MB of the cost.
#
# libnss3-tools is not a browser library: it is `certutil`, which serve.sh uses
# to write the sandbox proxy's CA into the NSS trust store the browser actually
# reads (see the CA import there). Without it every https:// preview fails with
# ERR_CERT_AUTHORITY_INVALID while curl and Node are fine.
#
# libicu is deliberately not installed: pwsh is not baked (it was ruled out of
# scope).
#
# --force-confold is load-bearing. mise pulls ca-certificates-bundle, which
# ships its own /etc/ssl/certs/ca-certificates.crt. The base image already has
# that file (created by the image, not by dpkg), so dpkg treats it as a
# modified conffile and stops at a prompt; non-interactively that leaves both
# packages in state iU and the next apt operation fails. Keeping the existing
# file is the point: that bundle is where the proxy CA lives, so --force-confnew
# (or deleting the file) breaks TLS for every curl in the sandbox.
#
# The sources are rewritten to https first. The image ships them as plain
# http://, and the sandbox proxy refuses unencrypted HTTP with a 403 that reads
# like a network outage — the build runs on the host and would never notice, a
# sandboxed `t3 browser setup` does. The DHI source is already https and is left
# alone. This does not make runtime apt work on its own: deb.debian.org is not
# in runtime.allow, so a missing library inside a sandbox is a `rebuild`, not an
# `apt-get` (see README Troubleshooting).
USER root
RUN set -eux; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources \
             /etc/apt/sources.list.d/*.list; do \
      [ -e "$f" ] || continue; \
      sed -i -E '/^(URIs:|deb |deb-src )/ s|http://|https://|g' "$f"; \
    done; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      -o Dpkg::Options::=--force-confold \
      libatomic1 mise \
      libglib2.0-0t64 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
      libdbus-1-3 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxrandr2 libxkbcommon0 libgbm1 libasound2t64 fontconfig fonts-liberation \
      libnss3-tools; \
    rm -rf /var/lib/apt/lists/*

# fd — pinned, in /usr/local/bin so pi's commandExists("fd") finds it and
# skips its own download. TARGETARCH (with a uname fallback) rather than a
# hardcoded triple: the kit's host support includes Apple silicon, so the
# image builds for arm64 as well as amd64. The musl build is static, so it
# does not depend on the base image's glibc. Root, because /usr/local/bin is
# not the agent's.
ARG TARGETARCH
RUN set -eux; \
    arch="${TARGETARCH:-$(uname -m)}"; \
    case "$arch" in \
      amd64|x86_64) fd_arch=x86_64-unknown-linux-musl ;; \
      arm64|aarch64) fd_arch=aarch64-unknown-linux-musl ;; \
      *) echo "unsupported architecture for fd: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/fd.tar.gz \
      "https://github.com/sharkdp/fd/releases/download/v${FD_VERSION}/fd-v${FD_VERSION}-${fd_arch}.tar.gz"; \
    tar -xzf /tmp/fd.tar.gz -C /tmp; \
    install -m 0755 "/tmp/fd-v${FD_VERSION}-${fd_arch}/fd" /usr/local/bin/fd; \
    rm -rf /tmp/fd.tar.gz "/tmp/fd-v${FD_VERSION}-${fd_arch}"; \
    /usr/local/bin/fd --version

USER agent
# Append, never replace: the base already puts /home/agent/.local/bin,
# /opt/python/bin, /go/bin and /usr/local/go/bin on PATH.
#
# mise's shims come *first*, so a non-interactive shell resolves node, go and
# python through mise. Not `mise activate`: that only hooks interactive shells,
# and the agent's bash tool is non-interactive, so every node call would
# silently fall back to the base image's 24. Java is not mise's — the base
# image's OpenJDK 21 is appended instead of taking egress for mise-java.
# A UTF-8 locale, or non-ASCII is unusable in the terminal.
#
# The base image sets none, so the sandbox runs LC_ALL=C and a terminal in it
# cannot type a Scandinavian character at all - and anything that renders one
# through the C locale shows mojibake (`Ränkimies` as `R├ñnkimies`, which is
# CP437's reading of the correct UTF-8 bytes).
#
# C.UTF-8 is the one UTF-8 locale that always exists in glibc without a
# locale-gen step, which is why it is named that and not en_US.UTF-8. It is
# deliberately not a language-specific locale: the sandbox should not impose
# collation or date formats on a repo that has its own opinion.
#
# This does not affect what `git config` writes - git is byte-transparent and
# stores the correct UTF-8 either way. It affects whether a human can type the
# character and whether it displays correctly.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    T3CODE_HOME=/home/agent/.t3 \
    T3CODE_HOST=0.0.0.0 \
    T3CODE_PORT=3773 \
    T3CODE_NO_BROWSER=1 \
    NPM_CONFIG_PREFIX=/home/agent/.npm-global \
    PATH=/home/agent/.local/share/mise/shims:/home/agent/.npm-global/bin:${PATH}:/usr/lib/jvm/java-21-openjdk-amd64/bin

# The baked default toolchain. mise reads this as its *global* config, so a
# repo that ships its own .mise.toml under /home/agent/workspace overrides it
# per project — but only for versions that are installed. A version that is
# not baked is a runtime `mise install`, which this kit deliberately does not
# allow (see install.allow vs runtime.allow in kit/t3-code.yaml).
#
# `mise install` writes the shims the ENV above puts first on PATH; reshim is
# belt and braces so the directory exists even on a mise that does not reshim
# on install. `mise trust` is the same belt: a config mise does not trust is
# skipped, and a skipped config leaves the shims with no version to resolve.
#
# This layer sits before t3 and pi on purpose: npm and npx then resolve through
# the shims, so pi's native modules are built for the node that will run them.
RUN mkdir -p /home/agent/.config/mise \
 && printf '[tools]\nnode = "%s"\ngo = "%s"\npython = "%s"\n' \
      "${NODE_VERSION}" "${GO_VERSION}" "${PYTHON_VERSION}" \
      > /home/agent/.config/mise/config.toml \
 && mise trust /home/agent/.config/mise/config.toml \
 && mise install \
 && mise reshim

# t3. install.sh honours T3CODE_VERSION, so this is a real pin.
#
# Not `curl … | sh`. Without pipefail a failed download hands `sh` an empty
# script, which exits 0, so the build goes green with no t3 in the image — and
# the sandbox then dies at startup with "t3: command not found" and a
# root-owned .t3 that serve.sh cannot write to. Download it, run it, and prove
# the binary is there before the layer is allowed to commit.
RUN curl -fsSL -o /tmp/t3-install.sh https://t3.codes/install.sh \
 && T3CODE_VERSION="${T3_VERSION}" T3CODE_INSTALL_BIN_DIR=/home/agent/.local/bin sh /tmp/t3-install.sh \
 && rm -f /tmp/t3-install.sh \
 && test -x /home/agent/.local/bin/t3

# T3's preview browser, baked. t3 downloads chrome-headless-shell on first
# render from storage.googleapis.com, and this kit's runtime policy refuses that
# host — so a fresh sandbox would never render, and the failure would arrive as
# a 403 dressed up as a missing-library error. Pre-seed the binary at the exact
# path t3 looks in, `$T3CODE_HOME/tools/chrome-headless-shell/<platform>/<version>/`.
#
# CHROME_VERSION is deliberately not a kit arg: it is not an independent choice,
# it has to be the version the baked t3 binary names. The sha256 below is the
# guard — it is t3's own value from the release table embedded in its binary, so
# a T3_VERSION bump that moves the Chrome pin fails this layer instead of
# leaving a binary t3 ignores and re-downloads (into a 403). If a future t3
# stops embedding that table verbatim the guard fails loudly, which is the
# intended failure mode: the pin has to be re-derived by hand. The sha differs
# per architecture because chrome-for-testing publishes one archive per
# platform.
#
# The assertions at the end are the point of the layer: the archive matches the
# pinned checksum, the loader resolves every library, and the binary starts. A
# wrong package name in the apt list above fails here, in minutes, instead of in
# the smoke on the host. `unzip`, `curl` and `sha256sum` are the base image's,
# the same way `tar` and `curl` are in the fd layer above.
ARG CHROME_VERSION=156.0.8078.80
RUN set -eux; \
    arch="${TARGETARCH:-$(uname -m)}"; \
    case "$arch" in \
      amd64|x86_64) chrome_platform=linux64; \
        chrome_sha256=547dcd374e02961bf998f6046a267644f8502225c36bb78ca307dab32a0b3eb4 ;; \
      arm64|aarch64) chrome_platform=linux-arm64; \
        chrome_sha256=5bb6a00a4285c13303d3f72c5afdb70f144ea7a93eed462365a52b69631c9607 ;; \
      *) echo "unsupported architecture for chrome-headless-shell: $arch" >&2; exit 1 ;; \
    esac; \
    t3_bin="$(readlink -f /home/agent/.local/bin/t3)"; \
    if ! grep -a -q "$chrome_sha256" "$t3_bin"; then \
      echo "t3 ${T3_VERSION} does not pin chrome-headless-shell ${CHROME_VERSION} for ${chrome_platform}" >&2; \
      echo "bump CHROME_VERSION and its sha256 to the release t3 names" >&2; \
      exit 1; \
    fi; \
    install_root="${T3CODE_HOME}/tools/chrome-headless-shell/${chrome_platform}"; \
    curl -fsSL -o /tmp/chrome-headless-shell.zip \
      "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/${chrome_platform}/chrome-headless-shell-${chrome_platform}.zip"; \
    echo "${chrome_sha256}  /tmp/chrome-headless-shell.zip" | sha256sum -c -; \
    unzip -q /tmp/chrome-headless-shell.zip -d /tmp/chrome-unpack; \
    mkdir -p "$install_root"; \
    mv "/tmp/chrome-unpack/chrome-headless-shell-${chrome_platform}" "${install_root}/${CHROME_VERSION}"; \
    rm -rf /tmp/chrome-headless-shell.zip /tmp/chrome-unpack; \
    browser="${install_root}/${CHROME_VERSION}/chrome-headless-shell"; \
    chmod 0755 "$browser"; \
    if ldd "$browser" | grep -q "not found"; then \
      echo "chrome-headless-shell has unresolved libraries:" >&2; \
      ldd "$browser" | grep "not found" >&2; \
      exit 1; \
    fi; \
    test "$("$browser" --version)" = "Google Chrome for Testing ${CHROME_VERSION}"

# pi — the agent harness t3 drives. Adding another provider is one more block
# like this one, plus its credential and its egress entry.
RUN npm install -g "@earendil-works/pi-coding-agent@${PI_VERSION}"

# Codex — the second agent t3 drives. t3 finds `codex` on PATH and starts its
# app-server; it does not need t3's managed install. The npm package is the
# official CLI and pulls the platform binary as an optional dependency, so the
# same line works on amd64 and arm64. Pinned like the toolchain: bumping it is
# a `rebuild`.
#
# `codex --version` is the assertion, not decoration: it proves the optional
# platform package resolved during the build, instead of failing later inside a
# sandbox where the npm registry is no longer the right place to fix it.
RUN npm install -g "@openai/codex@${CODEX_VERSION}" \
 && codex --version

# Vite+ — the v2 toolchain's test/lint/format runner, installed globally so
# `vp` is on PATH in every sandbox without a repo-local install. Same npm
# prefix as pi, and the same rule: the pin is a build arg, so bumping it is a
# `rebuild`.
RUN npm install -g "vite-plus@${VITE_PLUS_VERSION}" \
 && vp --version

# Skills — the workflow the docs describe (/triage, /code-review,
# /grill-with-docs, /wayfinder). Baked in rather than added at runtime:
# nothing self-updates inside the sandbox, and a skill you add by hand does
# not survive a rebuild. See docs/adr/0001-skills-baked-into-image.md.
#
# -a pi, not --all: the base image also includes `claude`, and adding a copy
# for an agent the kit does not support is unexplained surface. --copy, not
# the default symlinks: the image must not depend on a cache directory that
# the last line removes. -g puts them in ~/.agents/skills, the CLI's global
# store for both pi and Codex — one copy, no indirection.
#
# The count assertion is the point: `-s` silently ignores a name that no
# longer exists upstream, so a SKILLS_REF bump that renames a skill would
# otherwise bake in one fewer skill with a green build. skills.sh is the one
# parser for the manifest, shared with npm run smoke.
COPY --chown=agent:agent skills.txt skills.sh /home/agent/
RUN DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 \
      npx -y "skills@${SKILLS_VERSION}" add \
        "https://github.com/mattpocock/skills/tree/${SKILLS_REF}" \
        --skill $(sh /home/agent/skills.sh names /home/agent/skills.txt) \
        --agent pi --global --copy --yes \
 && [ "$(ls -1 /home/agent/.agents/skills | wc -l)" -eq \
      "$(sh /home/agent/skills.sh count /home/agent/skills.txt)" ] \
 && rm -f /home/agent/skills.txt /home/agent/skills.sh \
 && rm -rf /home/agent/.npm/_npx

COPY --chown=agent:agent serve.sh /home/agent/serve.sh
# Strip CR defensively: a Windows clone with core.autocrlf=true turns the
# shebang into "#!/usr/bin/env bash\r", which fails to exec with no useful
# error. .gitattributes is the real fix; this is the belt.
RUN sed -i 's/\r$//' /home/agent/serve.sh && chmod 0755 /home/agent/serve.sh

# A volume path: repos live here, never on the host.
WORKDIR /home/agent/workspace
ENTRYPOINT ["/home/agent/serve.sh"]
