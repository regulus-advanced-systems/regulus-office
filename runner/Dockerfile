# Agent runner image: one long-lived container per human (docs/SPEC.md §8).
# Contains tmux, git, gh, node, bun, python, uv and the agent CLIs. Agents run here, never in the
# office-server container. Build it with Compose from deploy/:
#   docker compose --profile build-only build runner-image
#
# Everything is installed system-wide (/usr/local, /usr/lib/node_modules) so the non-root runner
# uid 1001 can use it; HOME (/home/runner) is the human's credential volume.
ARG BUN_VERSION=1.4.2
ARG UV_VERSION=0.12.19

FROM oven/bun:${BUN_VERSION} AS bun
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git tmux openssh-client build-essential python3 python3-venv \
      jq unzip locales \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8 TERM=xterm-256color COLORTERM=truecolor

# Node 22 (Claude Code, Codex, Gemini CLI, Kimi Code and OpenCode ship as npm packages).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bun and uv as plain binaries on the system PATH, not under /root (which uid 1001 cannot read).
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=uv /uv /uvx /usr/local/bin/
RUN ln -s bun /usr/local/bin/bunx && bun --version && uv --version

# GitHub CLI.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Agent CLIs, pinned: the adapters parse their protocols and output, so bump deliberately.
ARG CLAUDE_CODE_VERSION=2.1.284
ARG CODEX_VERSION=0.158.0
ARG GEMINI_CLI_VERSION=0.61.0
ARG KIMI_CODE_VERSION=2.1.1
ARG OPENCODE_VERSION=1.18.33
RUN npm install -g --no-fund --no-audit \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@openai/codex@${CODEX_VERSION}" \
      "@google/gemini-cli@${GEMINI_CLI_VERSION}" \
      "@moonshot-ai/kimi-code@${KIMI_CODE_VERSION}" \
      "opencode-ai@${OPENCODE_VERSION}" \
    && npm cache clean --force \
    && command -v claude codex gemini kimi opencode

# The CLIs above are root-owned and runners are non-root, so a CLI updating itself can only fail
# ("Auto update failed: no write permission to npx prefix", #162). Versions come from this image:
# rebuild it to update them. Claude Code: DISABLE_AUTOUPDATER stops the background check and
# DISABLE_UPDATES also blocks `claude update` (https://code.claude.com/docs/en/setup#disable-auto-updates).
# Codex has no env for this; `check_for_update_on_startup = false` in the system config layer
# /etc/codex/config.toml (https://learn.chatgpt.com/docs/config-file/config-basic) stops its
# startup update check and prompt, and a human's own ~/.codex/config.toml still takes precedence.
ENV DISABLE_AUTOUPDATER=1 DISABLE_UPDATES=1
RUN mkdir -p /etc/codex \
    && printf '%s\n' '# Regulus Office runner: CLI versions come from the image.' \
      'check_for_update_on_startup = false' > /etc/codex/config.toml \
    && chmod 0644 /etc/codex/config.toml

# Floor checkouts under /srv/office belong to the office user and are shared with runners through
# group 1001 (deploy/docker-compose.yml); without this git refuses them as "dubious ownership".
RUN git config --system --add safe.directory '*'

# umask 0002 in every shell, so files agents create in floor dirs stay group-writable and the
# office (a member of group 1001) can manage and remove them. The office also sets it for every
# tmux session and piped process it starts (apps/server/src/runners/docker).
RUN echo 'umask 0002' > /etc/profile.d/office-umask.sh \
    && printf '\numask 0002\n' >> /etc/bash.bashrc \
    && sed -i 's/^UMASK[[:space:]].*/UMASK 002/' /etc/login.defs

# Non-root runner user: uid 1001 with primary group 1001, the group floor dirs are shared with.
# The office maps each human to one runner container; HOME holds that human's credentials.
RUN useradd -m -s /bin/bash -u 1001 -U runner && test "$(id -g runner)" = 1001
USER runner
WORKDIR /home/runner
ENV HOME=/home/runner IS_SANDBOX=1

CMD ["sleep", "infinity"]
