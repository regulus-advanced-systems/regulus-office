# Agent runner image: one long-lived container per human (docs/SPEC.md §8).
# Contains tmux, git, gh and the agent CLIs. Agents run here, never in the office-server container.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git tmux openssh-client build-essential python3 python3-venv \
      jq unzip locales \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8 TERM=xterm-256color COLORTERM=truecolor

# Node (for Claude Code, Codex, Gemini CLI, Kimi Code) and Bun.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# GitHub CLI.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# Agent CLIs. Pin versions in CI; latest here for the skeleton.
RUN npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli @moonshot-ai/kimi-code \
    && curl -fsSL https://opencode.ai/install | bash

# Non-root runner user. The office maps each human to a uid; HOME holds that human's credentials.
RUN useradd -m -s /bin/bash -u 1001 runner
USER runner
WORKDIR /home/runner
ENV HOME=/home/runner IS_SANDBOX=1

CMD ["sleep", "infinity"]
