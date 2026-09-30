# Test runner image for tests/e2e/agents.e2e.ts: the shape of runner/Dockerfile (non-root uid,
# HOME=/home/runner, IS_SANDBOX=1, sleep infinity) with only bash, tmux, git and curl, plus the
# fake `claude` and the hook runner it sources (claude-hooks.sh) from this directory. It is NOT Claude Code and has no agent CLIs, so it builds in
# seconds and no real account can ever be involved.
#
# RUNNER_UID/RUNNER_GID default to runner/Dockerfile's 1001; the e2e harness passes the host
# user's ids so the runner can write the worktrees the office (running as that user) creates.
FROM debian:bookworm-slim
ARG RUNNER_UID=1001
ARG RUNNER_GID=1001
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates curl git tmux \
    && rm -rf /var/lib/apt/lists/*
COPY claude claude-hooks.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/claude && chmod 0644 /usr/local/bin/claude-hooks.sh \
    && git config --system --add safe.directory '*' \
    && (getent group "$RUNNER_GID" >/dev/null || groupadd -g "$RUNNER_GID" runner) \
    && useradd -m -s /bin/bash -o -u "$RUNNER_UID" -g "$RUNNER_GID" runner
USER ${RUNNER_UID}:${RUNNER_GID}
WORKDIR /home/runner
ENV HOME=/home/runner IS_SANDBOX=1 LANG=C.UTF-8 TERM=xterm-256color
CMD ["sleep", "infinity"]
