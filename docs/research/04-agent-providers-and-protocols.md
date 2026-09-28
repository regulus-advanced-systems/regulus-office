# Research: embedding AI coding agents (providers, auth, protocols)

Research date: 2026-09-28. Summarised from official docs and locally installed binaries (`claude` 2.1.283, `codex-cli` 0.158.0). Items marked UNCERTAIN need re-verification before the relevant milestone.

## Headline facts that shape the design

1. **Anthropic policy.** Third-party products may not offer claude.ai login, may not store or intermediate Claude.ai credentials or session tokens, and may not route requests through Pro/Max credentials on behalf of users. They explicitly tolerate "an end user signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code." Consequence: the office must spawn the unmodified `claude` binary in the user's own HOME/container, the user logs in inside that terminal, and the office talks to Claude Code only through official surfaces (`-p` stream-json, Agent SDK, hooks, statusline). No "Sign in with Claude" button, no storing setup-tokens, no shared Max account. Source: https://code.claude.com/docs/en/legal-and-compliance (policy changed three times in H1 2026; re-check before launch).
2. **OpenAI endorses third-party harnesses** using Sign in with ChatGPT (OpenCode, OpenClaw, Pi named). Codex ships a first-party JSON-RPC app-server with device-code login, rate-limit and token-usage APIs. Rule: one account per user, no proxying or reselling.
3. **Gemini CLI dropped consumer Google login on 2026-06-18** (moved to the proprietary Antigravity CLI). Gemini CLI works with `GEMINI_API_KEY`, Vertex, or Code Assist Standard/Enterprise OAuth. Google's ToS forbids third-party software calling the Code Assist service with the CLI's OAuth; spawning the real `gemini` binary (as Zed does) is the sanctioned path.
4. **DeepSeek, Kimi and Z.AI have no first-party agent we should wrap.** They are consumed through Claude Code, Codex or OpenCode via base-URL overrides plus a plan/API key. Their plan keys are meant for "officially supported tools", which include Claude Code, Codex, OpenCode and Hermes.

## Per-agent profiles

### Claude Code + Agent SDK (proprietary binary; SDK bundles it)
- Auth: subscription OAuth via `/login` or `claude auth login`; `ANTHROPIC_API_KEY`; `ANTHROPIC_AUTH_TOKEN` (bearer for gateways such as Z.AI/Kimi/DeepSeek); `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, one year). Precedence: cloud vars > `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > apiKeyHelper > `CLAUDE_CODE_OAUTH_TOKEN` > console profile > `/login` creds.
- Storage: `~/.claude/.credentials.json` (0600), `~/.claude.json` (app state), `~/.claude/settings.json`. Transcripts at `~/.claude/projects/<cwd-slug>/<session>.jsonl` with `message.usage` per assistant entry (format declared unstable).
- Relocation: `CLAUDE_CONFIG_DIR` moves settings, credentials, transcripts, plugins. `CLAUDE_CODE_PROJECT_DIR_NAME` (v2.1.234+) is documented for embedding hosts. UNCERTAIN whether `~/.claude.json` moves; also set `HOME`.
- Headless: `claude -p --output-format stream-json --input-format stream-json --include-partial-messages`; `--permission-mode`, `--allowedTools`, `--disallowedTools`, `--max-budget-usd`, `--resume <id>`, `--session-id <uuid>`, `--fork-session`. Result line carries `session_id`, `total_cost_usd`, `usage`, `modelUsage`. `--bare` never reads OAuth creds (API key only). `--dangerously-skip-permissions` is refused as root unless `IS_SANDBOX=1`.
- Background daemon: `claude --bg`, `claude agents --json`, `claude attach|logs|stop`.
- Agent SDK (`@anthropic-ai/claude-agent-sdk`): spawns the CLI subprocess; `query()` async generator with `interrupt()`, `setPermissionMode()`, `canUseTool()` callback, hooks, `resume`, `forkSession`, `SessionStore`. SDK docs say third parties must use API-key auth, not claude.ai login.
- Hooks: `Notification` (matchers `permission_prompt`, `idle_prompt`, `agent_needs_input`, `agent_completed`), `Stop`, `PermissionRequest`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`; hooks can be `type: "http"` POSTing JSON to the host. Statusline command receives JSON with `cost`, `context_window` and, for subscribers, `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`. This is the sanctioned way to read plan limits. Do NOT call the undocumented `/api/oauth/usage` endpoint with users' tokens.
- Headless login: paste-a-code fallback when the browser cannot reach the local callback (SSH, containers). Reliability UNCERTAIN across releases.
- ACP: adapter `@agentclientprotocol/claude-agent-acp` (Apache-2.0, built on the Agent SDK). Adapters may not brand themselves "Claude Code".

### OpenAI Codex CLI + SDK + app-server (Apache-2.0)
- Auth: ChatGPT OAuth (all plans incl. Free) or API key. `codex login --device-auth` prints URL + user code and polls (works over SSH, no callback port). `codex login --with-api-key`, `--with-access-token` (stdin). Storage `~/.codex/auth.json`; `CODEX_HOME` relocates everything (config, auth, sessions, daemon sockets, SQLite). Docs bless copying `auth.json` into containers.
- Headless: `codex exec --json [-s read-only|workspace-write|danger-full-access] [-a on-request|never] [-C dir] [--worktree] [-m model]`; events `thread.started`, `turn.started`, `turn.completed{usage}`, `item.*`. Resume: `codex exec resume <id>`.
- **App-server** (`codex app-server`, stdio/unix/ws, plus shared daemon): JSON-RPC used by the VS Code extension. `thread/start|resume|fork|list|read`, `turn/start|steer|interrupt`, `account/login/start {type:"chatgptDeviceCode"} -> {verificationUrl,userCode}`, `account/rateLimits/read`, `account/usage/read`, `model/list`. Approval requests `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`. Notifications `thread/tokenUsage/updated`, `account/rateLimits/updated`, `item/agentMessage/delta`, `turn/diff/updated`, `turn/plan/updated`. Generate typed bindings with `codex app-server generate-ts`. Best-in-class structured surface.
- `codex --remote ws://host:port` attaches the TUI to a remote app-server. `notify = [...]` in `config.toml` fires on `agent-turn-complete`; `[hooks]` for `PreToolUse` etc.
- Sessions migrating from rollout JSONL to SQLite; read via `thread/read`, not files.
- ACP: adapter `@agentclientprotocol/codex-acp` (TS, Apache-2.0) drives the app-server.

### Gemini CLI (Apache-2.0)
- Auth: `GEMINI_API_KEY`, Vertex (`GOOGLE_CLOUD_PROJECT` + ADC), Code Assist Standard/Enterprise OAuth. Storage `~/.gemini/oauth_creds.json`, `settings.json`. Relocation `GEMINI_CLI_HOME`. `NO_BROWSER=true` paste-code flow (reliability UNCERTAIN).
- Headless: `gemini -p "..." -o stream-json`, `--approval-mode default|auto_edit|yolo|plan`, `--resume`. JSON output includes per-model token stats. OpenTelemetry local file exporter (`telemetry.target=local`, `gemini_cli.token.usage` metric) is the cleanest host-readable usage source.
- ACP: native `gemini --acp` (reference implementation). Usage reported non-standard in `_meta.quota.token_count`. Cannot force API-key auth non-interactively over ACP (issue #10855): pre-seed env.

### DeepSeek
- No official CLI/agent. API only, pay-per-token. Anthropic-compatible endpoint `https://api.deepseek.com/anthropic`: Claude Code with `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_MODEL=deepseek-flash`; opus→`deepseek-v4-pro`, sonnet/haiku→`deepseek-flash`. Also OpenCode provider.

### Kimi (Moonshot)
- `MoonshotAI/kimi-code` (Kimi Code CLI, MIT, Node >= 22.19) replaces the archived Python kimi-cli. Auth: `kimi login` device-code or Moonshot API key; data under `~/.kimi-code/` (`KIMI_CODE_HOME`). Headless `kimi -p --output-format stream-json`, `--yolo|--auto|--plan`, `--continue`, `--session <id>`. Native `kimi acp`. `kimi web` local server (shape UNCERTAIN).
- Claude Code with Kimi Code plan: `ANTHROPIC_BASE_URL=https://api.kimi.ai/coding/` (or `.com`), `ANTHROPIC_API_KEY=<Kimi Code key>`, `ANTHROPIC_MODEL=k3-256k`. Usage: 5-hour + monthly windows; semi-official `GET https://api.kimi.com/coding/v1/usages` (UNCERTAIN).

### Z.AI (Zhipu GLM)
- Own agent: ZCode (Apache-2.0, Electron/web/CLI; headless flags and ACP UNCERTAIN). `npx @z_ai/coding-helper` configures Claude Code/Codex/OpenCode for the plan.
- Claude Code via GLM Coding Plan (confirmed): settings env `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `API_TIMEOUT_MS=3000000`. Codex: `base_url="https://api.z.ai/api/v1"`, `wire_api="responses"`. OpenCode provider `zai-coding-plan`. Quotas are credit-based per 5-hour and weekly windows; semi-official usage endpoint `GET https://api.z.ai/api/monitor/usage/quota/limit` (UNCERTAIN).

### OpenCode (MIT, repo now anomalyco/opencode)
- Auth: `opencode auth login` → `~/.local/share/opencode/auth.json`; config `opencode.json` / `OPENCODE_CONFIG` / `OPENCODE_CONFIG_CONTENT`. Claude Pro/Max OAuth removed 2026-03-19 after Anthropic legal requests. ChatGPT Plus/Pro OAuth supported. Copilot device-code. DeepSeek/Kimi/Z.AI via API key.
- **Server mode first-class**: `opencode serve --port 4096`, OpenAPI at `/doc`, SSE `/event` (`session.idle`, `permission.updated`, `message.part.updated`), `POST /session`, `/session/:id/message`, `/session/:id/permissions/:id`. `opencode --attach http://...` attaches a TUI to the same server (true co-drive). SDK `@opencode-ai/sdk`. Native `opencode acp`.
- Headless `opencode run --format json`, `--continue`, `--session`, `--fork`, `--auto`. Permission config per tool with `allow|ask|deny` and glob rules. Plugins with hooks.

### Hermes Agent (Nous Research, MIT, Python core)
- Run: `hermes` REPL/TUI, `hermes chat -q "..." --oneshot --format stream-json`, `hermes -z "<prompt>"` (one-shot, `--usage-file`), `-r/--resume`, `--yolo`. `HERMES_HOME`; `hermes profile create <name>` gives isolated homes (config, memory, sessions, cron).
- Programmatic surfaces: OpenAI-compatible API server inside `hermes gateway` (port 8642: `/v1/chat/completions`, Runs API with SSE, Jobs API for cron, Sessions API); TUI gateway JSON-RPC over stdio/WebSocket (`hermes serve`, port 9119: `session.create`, `prompt.submit`, `session.steer`, `session.interrupt`, approval/clarify requests); `hermes acp`. Messaging gateway for Telegram/Discord/Slack/etc.
- Tools/permissions: 70+ tools in toolsets; terminal backends local|docker|ssh|modal|...; `approvals.mode smart|manual|off`, allow/deny globs, `HERMES_WRITE_SAFE_ROOT`.
- **Cron native**: `hermes cron create "every day at 8am" "<prompt>" --deliver ...`; official daily-briefing tutorial. Skills (`SKILL.md`), plugins, MCP client and server, memory files.
- Provider auth: Nous Portal OAuth, OpenRouter/OpenAI/Anthropic keys, ChatGPT device-code, can adopt Claude Code's credential store (Anthropic OAuth only works on Max with extra usage; policy-risky).

### OpenClaw (MIT, TypeScript, foundation-backed)
- Gateway WebSocket control plane `ws://127.0.0.1:18789` (token/password auth, device pairing, protocol v4: `chat.send`, `sessions.list`, `agent`, `cron.*`, events `session.message`, `session.tool`, `presence`). Same port serves OpenAI-compatible HTTP, webhooks, Control UI. Headless `openclaw agent exec "<prompt>" --json` (stable envelope with `usage`, `costUsd`, `sessionId`).
- Sessions in SQLite under `~/.openclaw/`; `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`. Multi-agent config with per-agent workspace/model/tools/sandbox.
- **Cron native**: `openclaw automations create "0 7 * * *" "..." --announce --channel ...`; heartbeat for periodic main-session turns.
- Tools/permissions: `tools.allow/deny`, `tools.exec.security`, approvals; Docker/Podman sandbox per agent/session. Skills via ClawHub, plugins.
- Provider auth: Anthropic API key, OpenAI key or ChatGPT OAuth, `claude-cli` runtime that runs turns through the installed logged-in `claude` binary. Can itself spawn Claude Code/Codex/Gemini/OpenCode via ACP (`@openclaw/acpx`).
- Security history: thousands of exposed gateways (Jan 2026), ~900 malicious ClawHub skills, CVE-2026-25253 RCE. Keep loopback bind, token auth, run `openclaw security audit`.

## Agent Client Protocol (ACP)
- "LSP for coding agents" by Zed, co-maintained with JetBrains; Apache-2.0; v1 stable, v2 draft (2026-07). JSON-RPC 2.0 over stdio, agent is the client's subprocess. HTTP/WebSocket transport is an active RFD, not stable.
- Agent methods: `initialize`, `authenticate`, `session/new|load|resume|list|close|delete`, `session/prompt` (returns `stopReason`, optional `usage`), `session/set_mode`, `session/cancel`. Client methods: `session/request_permission` (options allow_once/allow_always/reject_once/reject_always), `fs/read_text_file|write_text_file`, `terminal/create|output|wait_for_exit|kill|release`, `elicitation/create`. Updates: message/thought chunks, `tool_call{kind read|edit|delete|move|search|execute|think|fetch|...,status,content(diff|terminal),locations}`, `plan`, `available_commands_update`, `current_mode_update`, `usage_update{used,size,cost?}`.
- Native: Gemini CLI, OpenCode, Kimi Code, Goose, Qwen Code, Cursor, Copilot CLI, Hermes, OpenClaw (as bridge), Antigravity, ~40 more. Adapters: Claude Code, Codex. Registry: `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`. TS SDK `@agentclientprotocol/sdk`.
- Good universal abstraction for structured chat: explicit permission requests, typed tool calls for desk animations, modes/config, discovery via registry. Limitations: no TUI passthrough; token/cost reporting uneven; auth opaque (pre-seed creds via env/config dirs); stdio-only in v1; adapters lag native tools.

## Integration strategy: hybrid, "structured by default, terminal on demand"
1. Every agent runs inside a tmux session per desk regardless of mode, in the owning user's HOME/container with credentials mounted read-only. Survives host restarts; multiple viewers can attach.
2. Primary control channel per agent: Codex app-server; OpenCode `serve` + SSE (TUI attaches to the same server, true co-drive); Claude Code via `-p` stream-json / Agent SDK / hooks + statusline (or `claude-agent-acp`); Gemini/Kimi/Goose/Copilot/Cursor natively via ACP; Hermes via JSON-RPC gateway; OpenClaw via WS gateway. Render our own desk-side activity feed from these events.
3. "Open terminal" as the second view: for structured agents spawn an attached TUI where supported (`opencode --attach`, `codex --remote`/`codex resume <id>`, `claude --resume <id>`). Claude Code and Codex do not support two concurrent drivers of one session: treat as hand-off, not co-drive. Agents without a structured mode use the terminal as primary with hook/OSC-title/capture-pane heuristics.
4. Status model: `idle | working | waiting_for_permission | waiting_for_input | error | offline` from structured events first, hooks second, OSC title/capture-pane last (tmux-handlr's fallback ladder is the state of the art).
5. Usage: in-band usage events plus periodic on-disk transcript parsing (ccusage approach, supports Claude/Codex/Gemini and 19+ agents) for anything done outside our channel.

Precedents: Agent of Empires (Rust, tmux + worktrees + web terminal + Docker), Webmux (Bun + xterm.js, tmux authoritative), Vibe Kanban, tmux-handlr, Codeman.

## Usage and limits per provider
- Claude: statusline JSON (`rate_limits.five_hour/seven_day`, `cost`, `context_window`) forwarded to the host; `-p`/SDK `result` cost; transcripts via ccusage-style parsing. Never call the undocumented OAuth usage endpoint.
- Codex: app-server `account/rateLimits/read` + `account/rateLimits/updated`, `thread/tokenUsage/updated`, `account/usage/read`. Credits-based since April 2026.
- Gemini: OTLP local telemetry; `-o json` stats; no public quota API.
- Kimi: `/usage` and semi-official `/coding/v1/usages`. Z.AI: dashboard and semi-official monitor endpoints. OpenCode: `step_finish` tokens/cost. Hermes: `--usage-file`, result events. OpenClaw: `agent exec --json` usage/costUsd.

## Multi-user credential isolation on one VM
- Relocation env vars: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `KIMI_CODE_HOME`, `OPENCODE_CONFIG` (+ `HOME`/`XDG_DATA_HOME` for auth.json, UNCERTAIN), `HERMES_HOME` or profiles, `OPENCLAW_STATE_DIR`.
- Option 1 (recommended baseline): one Linux user per office user; agents spawned under that uid (via `systemd-run --uid` or a per-user desk daemon) inside that user's tmux server; credentials in that user's HOME with 0600. Matches Anthropic's tolerated pattern. Root-run agents trip Claude's root guard unless `IS_SANDBOX=1`.
- Option 2: same uid + per-session env dirs. Only acceptable if each agent runs in its own container with only its own credential dir mounted.
- Option 3: container per agent with `--user` mapping and the user's credential dirs bind-mounted. Combines both.
- Never share one subscription credential across users (Anthropic, OpenAI, Kimi, Z.AI all forbid it).
- Web-UI-friendly logins: Codex true device code (CLI flag or app-server `account/login/start`, render URL + code in our UI); Kimi device code; Gemini paste-code with `NO_BROWSER=true` (drive via PTY); Claude paste-code fallback in `claude auth login` (drive via PTY; user completes it in their own terminal so the unmodified binary writes the credential). Copilot (via OpenCode) device code.

## Key uncertainties to re-verify before building
- Reliability of Claude Code's and Gemini CLI's paste-code login over a PTY.
- Whether `CLAUDE_CONFIG_DIR` relocates `~/.claude.json`; whether OpenCode honors `XDG_DATA_HOME`.
- Kimi Code CLI stream-json input, `kimi web` API, credential filename; ZCode headless/ACP.
- Semi-official usage endpoints (Kimi, Z.AI, OpenCode Zen/Go).
- Anthropic subscription policy for programmatic use is "paused, in flux" as of June 2026.
- Codex rollout JSONL → SQLite migration: use app-server reads.
