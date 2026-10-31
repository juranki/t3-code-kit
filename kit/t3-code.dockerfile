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

# The skills pin is a commit, not a branch, and that is load-bearing: with a
# ref set the `skills` CLI clones at that sha instead of asking api.github.com
# for a repository tree, so the build reaches only github.com and
# registry.npmjs.org — no new install-time host in network-policy@2. Verified
# with api.github.com blackholed: same 27 skills, byte-identical, hashes
# computed locally.
ARG SKILLS_VERSION=1.7.4
ARG SKILLS_REF=a496f5513d4a4cf889bc48e189e579f4b0bdf6aa

# t3 ships prebuilt native modules that link libatomic.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends libatomic1 \
 && rm -rf /var/lib/apt/lists/*

USER agent
# Append, never replace: the base already puts /home/agent/.local/bin,
# /opt/python/bin, /go/bin and /usr/local/go/bin on PATH.
ENV T3CODE_HOME=/home/agent/.t3 \
    T3CODE_HOST=0.0.0.0 \
    T3CODE_PORT=3773 \
    T3CODE_NO_BROWSER=1 \
    PATH=/home/agent/.npm-global/bin:${PATH}

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
RUN npm config set prefix /home/agent/.npm-global \
 && npm install -g "@earendil-works/pi-coding-agent@${PI_VERSION}"

# Skills — the workflow the docs describe (/triage, /code-review,
# /grill-with-docs, /wayfinder). Baked in rather than installed at runtime:
# nothing self-updates inside the sandbox, and a hand install does not survive
# a rebuild. See docs/adr/0001-skills-baked-into-image.md.
#
# -a pi, not --all: the base image also ships `claude`, and installing to an
# agent the kit does not support is unexplained surface. --copy, not the
# default symlinks: the image must not depend on a cache directory that the
# last line removes. -g puts them in ~/.agents/skills, which is both the CLI's
# global store and pi's Agent Skills location — one copy, no indirection.
#
# The count assertion is the point: `-s` silently ignores a name that no
# longer exists upstream, so a SKILLS_REF bump that renames a skill would
# otherwise ship one fewer skill with a green build.
COPY --chown=agent:agent skills.txt /home/agent/skills.txt
RUN DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 \
      npx -y "skills@${SKILLS_VERSION}" add \
        "https://github.com/mattpocock/skills/tree/${SKILLS_REF}" \
        --skill $(grep -ve '^[[:space:]]*#' -e '^[[:space:]]*$' /home/agent/skills.txt | tr '\n' ' ') \
        --agent pi --global --copy --yes \
 && [ "$(ls -1 /home/agent/.agents/skills | wc -l)" -eq \
      "$(grep -cve '^[[:space:]]*#' -e '^[[:space:]]*$' /home/agent/skills.txt)" ] \
 && rm -f /home/agent/skills.txt \
 && rm -rf /home/agent/.npm/_npx

COPY --chown=agent:agent serve.sh /home/agent/serve.sh
# Strip CR defensively: a Windows clone with core.autocrlf=true turns the
# shebang into "#!/usr/bin/env bash\r", which fails to exec with no useful
# error. .gitattributes is the real fix; this is the belt.
RUN sed -i 's/\r$//' /home/agent/serve.sh && chmod 0755 /home/agent/serve.sh

# A volume path: repos live here, never on the host.
WORKDIR /home/agent/workspace
ENTRYPOINT ["/home/agent/serve.sh"]
