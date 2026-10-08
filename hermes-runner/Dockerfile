# Hermes image for "Hermes, run by the office" (#57): one container per managed Hermes agent,
# created by the office itself (apps/server/src/pm/hermes/managed/docker-host.ts). Build it with
# Compose from deploy/:
#   docker compose --profile build-only build hermes-image
# and name it to the office with OFFICE_HERMES_IMAGE (deploy/.env.example).
#
# It is the official Hermes Agent image (https://github.com/NousResearch/hermes-agent, MIT licence),
# pinned by digest to release v2026.9.24 (hermes-agent 0.21.5), which is the release the office's
# Hermes client was written against. To move to another release, change the tag and the digest
# together and run the checks in the README ("Hermes run by the office").
#
# What this file changes, and why:
# - A non-root user with the runner uid 1001 (the office starts every container as
#   OFFICE_DOCKER_RUNNER_USER with all capabilities dropped). The official image starts as root
#   under s6 and drops to uid 10000; none of that runs here.
# - No entrypoint: the container only sleeps. The office starts `hermes gateway run` in it with an
#   exec, so the API key and the model key live in that exec's environment and never in the
#   container's configuration.
# - Hermes's home is /home/hermes/.hermes, on the agent's own volume mounted at /home/hermes.
ARG HERMES_IMAGE=nousresearch/hermes-agent:v2026.9.24@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7
FROM ${HERMES_IMAGE}

USER root
RUN groupadd -g 1001 office-hermes \
    && useradd -m -d /home/hermes -s /bin/bash -u 1001 -g 1001 office-hermes \
    && mkdir -p /home/hermes/.hermes \
    && chown -R 1001:1001 /home/hermes \
    && chmod 700 /home/hermes

# The gateway in the foreground, not handed to the image's s6 supervisor (which is not running).
ENV HOME=/home/hermes \
    HERMES_HOME=/home/hermes/.hermes \
    HERMES_WRITE_SAFE_ROOT=/home/hermes/.hermes \
    HERMES_LAZY_INSTALL_TARGET=/home/hermes/.hermes/lazy-packages \
    HERMES_GATEWAY_NO_SUPERVISE=1 \
    XDG_RUNTIME_DIR=/tmp/hermes-runtime \
    PATH=/opt/hermes/bin:/opt/hermes/.venv/bin:/home/hermes/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    IS_SANDBOX=1

USER 1001:1001
WORKDIR /home/hermes
# Fails the build if the pinned release is not what the office expects.
RUN hermes --version | grep -F "0.21.5"

ENTRYPOINT []
CMD ["sleep", "infinity"]
