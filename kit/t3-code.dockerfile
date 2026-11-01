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
# `t3-code-kit rebuild`.
ARG T3_VERSION=0.1.5
ARG PI_VERSION=latest

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
ARG VITE_PLUS_VERSION=1.4.0

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
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      -o Dpkg::Options::=--force-confold \
      libatomic1 mise \
 && rm -rf /var/lib/apt/lists/*

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

# pi — the agent harness t3 drives. Adding another provider is one more block
# like this one, plus its credential and its egress entry.
RUN npm install -g "@earendil-works/pi-coding-agent@${PI_VERSION}"

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
# the last line removes. -g puts them in ~/.agents/skills, which is both the
# CLI's global store and pi's Agent Skills location — one copy, no
# indirection.
#
# The count assertion is the point: `-s` silently ignores a name that no
# longer exists upstream, so a SKILLS_REF bump that renames a skill would
# otherwise bake in one fewer skill with a green build. skills.sh is the one
# parser for the manifest, shared with bin/smoke.
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
