# syntax=docker/dockerfile:1

# The sandbox platform floor — bash, the non-root `agent` user (uid 1000), git,
# a CA store — comes from Docker's template images. A bare distro builds fine
# and then fails at agent launch with a missing /bin/bash.
#
# ⚠️ Early Access reference. Confirm it on the host (`sbx template ls`) before
# trusting it; `docker/sandbox-templates:ubuntu` is the fallback. Swapping the
# base should stay a one-line change.
ARG BASE=dhi.io/sbx-templates:claude-code-docker
FROM ${BASE}

# Pinned on purpose: nothing self-updates inside the sandbox. Bumping is a
# `t3-code-kit rebuild`.
ARG T3_VERSION=0.1.5
ARG PI_VERSION=latest

# t3 ships prebuilt native modules that link libatomic.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends libatomic1 \
 && rm -rf /var/lib/apt/lists/*

USER agent
ENV T3CODE_HOME=/home/agent/.t3 \
    T3CODE_HOST=0.0.0.0 \
    T3CODE_PORT=3773 \
    T3CODE_NO_BROWSER=1 \
    PATH=/home/agent/.local/bin:/home/agent/.npm-global/bin:/usr/local/bin:/usr/bin:/bin

# t3. install.sh honours T3CODE_VERSION, so this is a real pin.
RUN curl -fsSL https://t3.codes/install.sh \
      | T3CODE_VERSION="${T3_VERSION}" T3CODE_INSTALL_BIN_DIR=/home/agent/.local/bin sh

# pi — the agent harness t3 drives. Adding another provider is one more block
# like this one, plus its credential and its egress entry.
RUN npm config set prefix /home/agent/.npm-global \
 && npm install -g "@earendil-works/pi-coding-agent@${PI_VERSION}"

COPY --chown=agent:agent serve.sh /home/agent/serve.sh
RUN chmod 0755 /home/agent/serve.sh

# A volume path: repos live here, never on the host.
WORKDIR /home/agent/workspace
ENTRYPOINT ["/home/agent/serve.sh"]
