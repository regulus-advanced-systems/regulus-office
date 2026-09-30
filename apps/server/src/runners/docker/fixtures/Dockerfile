# Tiny stand-in for runner/Dockerfile used by the docker runner integration test:
# same shape (non-root uid 1001, HOME=/home/runner, IS_SANDBOX=1, sleep infinity)
# but only tmux instead of the agent CLIs, so it builds in seconds. busybox gives
# the sandbox test (#169) a tiny web server and client.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tmux busybox \
    && rm -rf /var/lib/apt/lists/*
COPY fake-agent.sh /usr/local/bin/fake-agent
RUN chmod 0755 /usr/local/bin/fake-agent && useradd -m -s /bin/bash -u 1001 runner
USER runner
WORKDIR /home/runner
ENV HOME=/home/runner IS_SANDBOX=1 LANG=C.UTF-8 TERM=xterm-256color
CMD ["sleep", "infinity"]
