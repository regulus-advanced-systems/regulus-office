# Regulus Office: Specification (draft v0.1, 2026-09-28)

Status: v0.2, decisions resolved with the owner on 2026-09-28 (see §14). Agents building from this document should treat it as authoritative. Research backing these decisions lives in `docs/research/`.

## 1. Vision

Regulus Office is an open-source, self-hosted, multiplayer office simulator in the browser. The player walks around an office drawn in the style of Game Dev Tycoon (isometric dollhouse rooms, warm cream backdrop, soft painterly shading). The employees are real AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode, Kimi Code, and any model reachable through them such as DeepSeek, Z.AI GLM, Kimi) rendered as cute low-poly robots sitting at desks and typing on laptops. Each project gets its own floor. Humans from the same company log in, see each other, share a whiteboard, a jukebox, a screen, GitHub boards and a task queue, and spawn or manage agents from any free desk. A project-manager robot (Hermes Agent or OpenClaw) walks the office, tracks progress, and presents a daily brief.

Design principles:
1. **Real agents, real terminals.** Every robot is a real CLI process the user can open and drive. Nothing is faked.
2. **Structured by default, terminal on demand.** Status, activity animations, cost and permission prompts come from typed agent events; the raw TUI is one click away.
3. **Per-user credentials, always.** Every human logs into their own providers. The office never stores or shares subscription tokens. This is both a security property and a provider-policy requirement (see research 04).
4. **Floor = project.** Navigation maps one-to-one onto the work structure.
5. **Look like Game Dev Tycoon, run on a laptop.** Fixed isometric camera, cheap rendering, DOM panels only where needed.
6. **Self-hostable by one person with Docker Compose.** Optional pieces (media SFU, Postgres) are Compose profiles.

## 2. Glossary

| Term | Meaning |
|---|---|
| Office | One deployment (one VM). Has a building with N floors. |
| Floor | One project. Bound to a git repository (usually GitHub). Has desks, boards, whiteboard, queue, decor. |
| Lobby | Ground floor. Elevator, reception, usage tracker wall, jukebox, lounge TV for screen share. |
| Human | A logged-in person with an avatar. Roles: `owner`, `admin`, `member`, `viewer`. |
| Robot / Agent | An AI coding agent process bound to a desk on a floor. Owned by the human who spawned it. |
| Provider | An agent CLI (Claude Code, Codex, Gemini CLI, OpenCode, Kimi Code) or a model backend routed through one (DeepSeek, Z.AI, Kimi plan). |
| Credential profile | A per-human, per-provider login or key, stored only inside that human's isolated HOME. |
| Desk | A seat with a laptop. Free or occupied by a robot. |
| PM robot | The Hermes/OpenClaw agent that walks the office, owned by the office (admin-configured), with scoped privileges. |
| Runner | The sandbox (container or Linux user) in which agents for a given human execute. |
| Session | One agent conversation with a provider session id, resumable. |

## 3. Personas and core loops

- **Ante (owner):** opens the office in a browser in the morning. The PM robot walks up and delivers the daily brief. Ante takes the elevator to the "primo" floor, sees three robots working, one with a raised hand (needs permission). Clicks it, the terminal opens, approves, closes. Walks to the issue board, drags issue #42 onto a free desk, picks "Claude Code / opus", the robot spawns and starts. Puts a picture on the wall. Queues four more issues in the task queue and leaves.
- **Teammate (member):** logs in, is asked once to connect providers. Opens the Codex device-code login in the office UI, then spawns Codex robots on the floors they have access to. Shares screen to the lobby TV while discussing a PR on the whiteboard.
- **Viewer:** can walk around and watch, cannot spawn or type into terminals.

## 4. Architecture

### 4.1 Overview

```
Browser (React + Three.js/R3F)  <--WS/HTTP-->  office-server (Bun)  --spawns-->  runners (per human)
   scene, HUD, panels                             auth, rooms, state,               tmux + agent CLIs
   xterm.js, Excalidraw,                          PTY bridge, GitHub,               per-user HOME + creds
   livekit-client                                 usage, PM bridge
                                                       |
                                                   SQLite (WAL) + blob dir
                                                       |
                                    optional: LiveKit SFU, Caddy (TLS), Postgres
```

One Bun process (`office-server`) owns: HTTP (REST + static), the multiplayer room server, the PTY/terminal bridge, the whiteboard sync endpoint, GitHub sync, usage aggregation, the PM-robot bridge, and the SQLite database. Agents never run inside this process; they run in runners.

### 4.2 Stack (decided; rationale in research 01)

| Layer | Choice |
|---|---|
| Runtime | Bun 1.3+, TypeScript strict, ESM. Monorepo with Bun workspaces. |
| Client | Vite, React 19, Three.js + @react-three/fiber + drei, zustand, xterm.js (`@xterm/xterm` + fit + webgl), `@excalidraw/excalidraw`, `livekit-client`. |
| Multiplayer | Colyseus with `@colyseus/bun-websockets`; schema-based delta state. Networking wrapped behind a small `RoomTransport` interface so a raw Bun WS fallback is possible. |
| Terminals | Bun native PTY (`Bun.spawn` with `terminal`) attaching to tmux sessions; raw binary WS per viewer. `bun-pty` as fallback. |
| Whiteboard | Excalidraw + Yjs (`y-excalidraw` binding) over a y-websocket endpoint in the same server; Yjs updates persisted in SQLite. tldraw is excluded (license). |
| Media | LiveKit self-hosted (Compose profile `media`). Screen share and voice. Optional. |
| Auth | Better Auth on `bun:sqlite`: email + password local accounts, GitHub social login, invite links, first-user-becomes-owner. Generic OAuth plugin for OIDC as operator option. |
| DB | SQLite via `bun:sqlite` in WAL through Drizzle ORM. Blobs (uploads, snapshots) on disk. Postgres later via Drizzle if ever needed. |
| GitHub | GitHub App (installation tokens, webhooks) with PAT fallback; `octokit`. Polling mode when no inbound URL. |
| Packaging | Docker Compose: `office` (server), `runner` image, `caddy`; profiles `media` (LiveKit), `pg`. `bun run dev` for development. |
| Agent protocols | Codex app-server (JSON-RPC), OpenCode serve (HTTP+SSE), Claude Code stream-json + hooks + statusline, ACP (`@agentclientprotocol/sdk`) for Gemini/Kimi/others, Hermes JSON-RPC gateway, OpenClaw WS gateway. |

### 4.3 Monorepo layout

```
regulus-office/
  package.json                 # bun workspaces
  apps/
    server/                    # office-server (Bun)
      src/
        http/                  # REST routes, static, uploads, GitHub webhook
        auth/                  # Better Auth setup, roles, invites
        rooms/                 # Colyseus rooms: BuildingRoom, FloorRoom
        agents/                # AgentManager, adapters/, status machine, usage
        terminals/             # tmux + PTY bridge, screen snapshots
        runners/               # runner backends: linux-user, docker
        github/                # App auth, sync, webhooks, board model
        whiteboard/            # y-websocket endpoint, persistence
        jukebox/               # playhead authority, library
        media/                 # LiveKit token minting
        pm/                    # PM robot bridge (Hermes/OpenClaw), brief delivery
        db/                    # Drizzle schema, migrations
        secrets/               # envelope encryption for API keys
    web/                       # Vite + React client
      src/
        scene/                 # R3F: cameras, floors, furniture, robots, decals, bubbles
        ui/                    # HUD, panels, dialogs (GDT-styled)
        net/                   # Colyseus client, terminal WS, yjs provider
        state/                 # zustand stores
        audio/                 # jukebox sync, ambience
  packages/
    protocol/                  # shared TS types + Colyseus schemas + zod validators
    agent-adapters/            # one adapter per provider, pure TS, testable without the server
    floor-layout/              # data-driven floor templates, nav grid, seat definitions
    assets/                    # GLB models, textures, CC0/CC-BY attribution manifest
  runner/                      # Dockerfile for the agent runner image (tmux, git, node, bun, python, CLIs)
  deploy/                      # docker-compose.yml, Caddyfile, .env.example, livekit.yaml
  docs/                        # SPEC.md, research/, ADRs
  tests/                       # e2e (Playwright) and integration
```

### 4.4 Runtime processes on the VM

- `office-server` (Bun), as a dedicated `office` Linux user.
- One tmux server per human, socket at `/run/office/tmux/<humanId>.sock`, owned by that human's runner identity.
- Agent processes inside tmux sessions named `agent-<agentId>`, executing inside that human's runner (see §8).
- Optional `livekit-server`, `caddy`.
- PM robot (Hermes or OpenClaw) as a long-lived service with its own profile/state dir, owned by the office.

## 5. Data model (SQLite, Drizzle)

Core tables (fields abbreviated; every table has `id`, `createdAt`, `updatedAt`):

- `users` (Better Auth) + `user_profiles`: `displayName`, `role`, `avatar` (robot colour set, accessory), `runnerId`, `linuxUid`.
- `invites`: `token`, `role`, `expiresAt`, `usedBy`.
- `floors` (= projects): `name`, `slug`, `index` (elevator order), `paletteId`, `layoutTemplateId`, `archivedAt`.
- `floor_repos`: `floorId`, `owner`, `name`, `url`, `defaultBranch`, `workdir`, `isPrimary`. A floor has 1..n repos; desks, worktrees and boards bind to one repo. Boards show all repos of the floor with a repo chip on each card.
- `floor_members`: `floorId`, `userId`, `access` (`manage|spawn|view`).
- `desks`: `floorId`, `seatId` (from layout), `agentId?` (occupied by).
- `agents`: `floorId`, `repoId`, `deskSeatId`, `ownerUserId`, `provider`, `model`, `effort?`, `profileId` (user profile or `office:<provider>`), `status`, `providerSessionId`, `tmuxSession`, `workdir`, `worktreeBranch?`, `taskTitle`, `taskSummary`, `issueNumber?`, `prNumber?`, `lastActivityAt`, `exitedAt`, `spawnArgsJson`.
- `agent_events`: `agentId`, `ts`, `kind` (`status|tool_call|permission_request|message|usage|exit`), `payloadJson`. Rolling retention.
- `credential_profiles`: `userId`, `provider`, `label`, `authKind` (`cli_login|api_key|base_url_key`), `encryptedSecret?` (envelope, only for API keys/plan keys), `baseUrl?`, `modelOverridesJson?`, `verifiedAt`. Subscription OAuth logins are never stored here; they live in the user's HOME written by the unmodified CLI.
- `usage_samples`: `userId`, `agentId?`, `provider`, `ts`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costUsdEstimate`, `source` (`inband|transcript|statusline`).
- `usage_limits`: `userId`, `provider`, `windowKind` (`five_hour|seven_day|monthly|credits`), `usedPct`, `resetsAt`, `observedAt`, `source`.
- `tasks` (queue): `floorId`, `position`, `kind` (`issue|pr|freeform`), `refNumber?`, `prompt`, `provider`, `model`, `effort?`, `autoWorktree`, `state` (`queued|running|done|failed|cancelled`), `agentId?`, `createdBy`.
- `github_issues`, `github_pulls`: cached board data (`number`, `title`, `state`, `labels`, `assignees`, `updatedAt`, `bodyMd`, `checksState`, `reviewState`, `raw`).
- `decor`: `floorId`, `kind` (`picture|poster|plant|...`), `wallId`, `x`, `y`, `w`, `h`, `blobPath`, `placedBy`.
- `whiteboards`: `floorId`, `ydocBlob`, `snapshotPng`, `version`.
- `jukebox_tracks`: `title`, `artist`, `source` (`file|youtube|url`), `ref`, `durationMs`, `addedBy`, `license`.
- `jukebox_state`: `trackId`, `startedAtServerMs`, `pausedAtMs?`, `volume`, `queueJson`.
- `services`: detected dev servers: `agentId`, `pid`, `port`, `url`, `title`, `firstSeenAt`, `lastSeenAt`.
- `pm_briefs`: `ts`, `forUserId?`, `markdown`, `deliveredAt?`.
- `audit_log`: `userId`, `action`, `targetKind`, `targetId`, `metaJson`.

## 6. Wire protocol (packages/protocol)

Two channels plus two side channels:

1. **Colyseus `BuildingRoom`** (one per office): presence of humans (`floorId`, position, heading, animation, `doing`), chat, jukebox state, usage-tracker summary, PM robot position/state, floor list with per-floor counters (busy/waiting robots). Low rate.
2. **Colyseus `FloorRoom`** (one per floor): robots on this floor (`RobotState`: seat, provider, model, status, action, taskTitle, handRaised, bubbleEmits), desks, decor, task queue, issue/PR board summaries, services, whiteboard snapshot version, carried-card state. Clients join the BuildingRoom always and exactly one FloorRoom at a time.
3. **Terminal WS** `/ws/term/<agentId>` (binary frames): PTY bytes out, keystrokes in, `resize` control frames. Auth checked per connection; `mode=watch|control`.
4. **Yjs WS** `/ws/wb/<floorId>` for the whiteboard.

Client→server commands (Colyseus messages, zod-validated): `move`, `sit`, `emote`, `chat`, `floor.go`, `agent.spawn`, `agent.prompt`, `agent.approve`, `agent.stop`, `agent.resume`, `agent.pr`, `queue.add|reorder|cancel`, `card.pick|drop`, `decor.place|move|remove`, `jukebox.play|pause|seek|enqueue|skip`, `screen.share.start|stop`, `pm.ask`.

Agent status enum (single source of truth in protocol): `starting | idle | working | waiting_permission | waiting_input | done | error | exited | offline`.
Agent action enum (drives animation): `none | typing | reading | editing | running_tests | browsing | thinking | failing | celebrating`.

## 7. Agent adapters (packages/agent-adapters)

Each adapter implements:

```ts
interface AgentAdapter {
  id: ProviderId;                              // 'claude-code' | 'codex' | 'gemini-cli' | 'opencode' | 'kimi-code' | 'custom'
  capabilities: { structured: boolean; attachTui: boolean; coDrive: boolean; resume: boolean; usageInband: boolean; limits: boolean; deviceLogin: boolean };
  buildSpawn(req: SpawnRequest, ctx: RunnerContext): SpawnPlan;     // argv, env, cwd, tmux session name, hook files to write
  connect(plan: SpawnPlan, ctx): AgentControl;                      // structured channel (or PTY-heuristic fallback)
  buildAttachTui(agent: AgentRecord, ctx): SpawnPlan | null;        // command to open the interactive TUI on the same session
  loginFlow(ctx): LoginFlow;                                        // 'device_code' | 'pty_paste_code' | 'api_key' | 'base_url_key'
  readUsage(ctx): AsyncIterable<UsageSample | LimitSample>;         // in-band + transcript scan
}
interface AgentControl {
  events: AsyncIterable<AgentEvent>;   // status, action, message chunk, tool_call, permission_request, usage, exit
  prompt(text: string, attachments?): Promise<void>;
  respondPermission(id: string, decision: 'allow_once'|'allow_always'|'reject'): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
```

Per-provider plan (from research 04):

| Provider | Primary control | TUI attach | Login in office UI | Usage / limits |
|---|---|---|---|---|
| Claude Code | tmux TUI is primary (subscription users) with hooks (`type: http`) + statusline forwarder for status/limits; `-p` stream-json / Agent SDK optional for API-key profiles | `claude --resume <id>` | User runs `/login` inside their own terminal (paste-code). Office never sees the token. API-key and base-URL profiles (DeepSeek, Z.AI, Kimi plan) are injected as env at spawn | statusline JSON (`rate_limits`, `cost`, `context_window`), `result` cost in `-p`, transcript scan |
| Codex | app-server JSON-RPC (persistent thread) | `codex resume <id>` or `codex --remote` | Device code via `account/login/start {chatgptDeviceCode}` rendered in UI; or API key | `account/rateLimits/*`, `thread/tokenUsage/updated`, `account/usage/read` |
| OpenCode | `opencode serve` per human + SSE; `opencode --attach` for TUI (true co-drive) | yes, co-drive | provider keys via config; ChatGPT OAuth via its own flow in terminal | `step_finish` tokens/cost |
| Gemini CLI | ACP (`gemini --acp`) | `gemini --resume` | API key or Vertex only (consumer OAuth gone) | OTLP local telemetry file |
| Kimi Code | ACP (`kimi acp`) | `kimi --session` | Device code (`kimi login` driven via PTY) or key | `/usage`, semi-official endpoint |
| DeepSeek / Z.AI / Kimi plan | Not adapters. They are `base_url_key` credential profiles applied to Claude Code, Codex or OpenCode spawns | | plan/API key pasted in UI, stored encrypted | provider dashboards; Z.AI/Kimi semi-official endpoints (best-effort) |
| Custom | PTY only; heuristics | n/a | n/a | none |

Status derivation ladder: structured events → hooks/notify → OSC title → `capture-pane` regex → transcript mtime.

## 8. Runners and credential isolation

Decided: **one runner identity per human**. Two backends, selectable per office:

- `linux-user` backend (default for bare-metal/VM installs): `useradd -m office-u-<id>`; agents launched via `systemd-run --uid --gid --scope --unit=agent-<id>` inside that user's tmux server; credential dirs live in that user's HOME (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.kimi-code`, `~/.local/share/opencode`). Project workdirs are cloned under `/srv/office/projects/<floor>/` and made group-accessible to that user's runner group; per-agent git worktrees under `/srv/office/worktrees/<floor>/<agent>/`. Each agent gets its own cgroup so process discovery and kill are exact.
- `docker` backend (default in Compose): one long-lived runner container per human built from `runner/Dockerfile` (tmux, git, gh, node, bun, python, uv, the agent CLIs), with the human's credential volume mounted at HOME and floor workdirs bind-mounted. `IS_SANDBOX=1` set so Claude's root guard is satisfied if the image runs as root; prefer a non-root uid. Docker socket is never mounted into runners. Agents needing Docker themselves are an opt-in profile (rootless DinD/sysbox) later.

Credential rules (hard requirements):
1. Subscription OAuth (Claude, ChatGPT) is only ever performed by the unmodified CLI inside the human's own runner. The office renders the login prompt (device code URL/code for Codex; the paste-code terminal for Claude) but never reads, stores or forwards tokens.
2. API keys and plan keys (DeepSeek, Z.AI, Kimi, Gemini, OpenAI/Anthropic keys) are stored encrypted (AES-256-GCM, envelope with `OFFICE_MASTER_KEY`), decrypted only at spawn time, injected as env into that human's agent, never logged, never shown after entry.
3. No office-wide shared *subscription* credentials, ever. An admin MAY add office-wide API keys for metered providers (DeepSeek, Anthropic API, OpenAI API, Gemini API) as an opt-in per provider; members choose per spawn whether to use their own profile or the office key; usage from office keys is attributed to `office` in the tracker.
4. Agents run as the spawning human's runner. Terminal ACL: all `member`s may watch any robot's terminal; control (typing, approving) requires being the robot's owner or an `admin`/`owner`; `viewer`s may only watch. Injected keys are therefore only readable by people who could already type into that robot.

## 9. World, floors, navigation

### 9.1 Building
- Lobby (floor 0): elevator bank, reception desk (PM robot's home), usage-tracker wall display, lounge with TV (screen share target), jukebox, whiteboard (building-wide), coffee machine, plants.
- Floor N (N ≥ 1): one project. Created when a floor is added; removed/archived with the project. Elevator panel lists floors with name, robot counts (working/waiting), and a colour chip. Quick menu (hotkey `F`) teleports without the ride; the elevator ride is a 1.5 s animation with a floor-change sound.
- Layout is data-driven (`packages/floor-layout`): a template JSON defines walls, floor material, seats (desk positions + facing), wall anchors for boards and pictures, nav-blocking rectangles, and spawn points. Initial template: "Office L2" modelled on GDT's second office (two back walls with windows, teal carpet, big shared table with 4 seats, CEO L-desk, cabinets, kitchenette corner, meeting table). Templates scale: `small` (6 desks), `medium` (12), `large` (20, two pods). Floor switches template when desks run out (owner-confirmed).
- Each floor has a palette (floor/wall/accent colours) taken from the GDT set (teal carpet + cream walls; oak + sky-blue/orange; lime/mustard/orange zones + crimson) and cycled per floor so floors are visually distinct; the floor name is painted on the exterior stub wall like "Greenheart Games".

### 9.2 Camera and controls
- Third-person (default): orthographic camera, yaw 45°, pitch 35.264°, fixed; scroll to zoom within limits; room centred in a cream `#FFF6D9` vignette. Click-to-walk (nav grid A*) plus WASD.
- First-person: perspective camera at robot eye height, pointer-lock, WASD, front stub walls become full walls. Toggle with `V` or a HUD button; a 300 ms crossfade.
- Interaction: hover highlights; `E` interacts with the nearest interactable (desk, board, elevator, jukebox, whiteboard, TV, picture frame); a radial context menu on right-click.

### 9.3 Avatars
- All characters (humans and robots) are cute low-poly robots (Quaternius Animated LowPoly Robot as base, CC0), retextured per user with a colour set and an accessory (antenna, visor, cap). Humans are distinguished from agents by a floating name plate colour and a "badge" mesh; agents have a provider logo-coloured chest light and an antenna bulb whose colour encodes status (grey starting, green idle, blue working, orange waiting-permission with a raised hand, red error, dark exited).
- Name labels for robots are floor decals next to the seat (GDT style); humans get a floating name plate.
- Animations: idle, walk, sit-type, sit-idle, read (papers), think (head tilt), celebrate (spin + confetti), facepalm (failing), wave, point. Driven from the action enum.
- Work bubbles: while `working`, the laptop emits GDT-style bubbles: cyan for tool calls, amber for file edits, blue for test runs, orange-red when a tool fails. Bubbles fly to the floor's HUD counters.

### 9.4 In-world objects
- Laptop screens: focused desk renders live xterm.js in a drei `<Html transform>`; all other desks show a `CanvasTexture` from tmux `capture-pane` text updated ~2/s.
- Issue board and PR board: cork boards on the wall; unfocused = canvas texture; click = 2D panel (GDT modal style). Cards can be plucked and carried to a desk (drop = spawn dialog prefilled with the issue).
- Task queue: a clipboard on the wall next to the boards; 2D panel.
- Whiteboard: canvas snapshot on the wall; click = full-screen Excalidraw.
- Picture frames: upload from the user's PC (PNG/JPG/WebP ≤ 10 MB), placed on wall anchors, resizable, removable by placer or admin.
- Usage-tracker wall (lobby, and a small one per floor): rendered with Canvas 2D: per-provider bars for the viewer's own limits (5-hour / weekly / credits), today's spend estimate, top robots by tokens. Only the viewer's own data plus office totals (never another user's limits).
- Services board: "Running apps" panel listing detected listening ports per robot with title and an "Open" button that goes through the office's authenticated reverse proxy (`/p/<floor>/port/<n>/`).
- Jukebox (lobby): queue UI; local files (uploaded, CC-licensed bundled set) with tight sync; YouTube via official iframe as HUD panel with loose sync. Spatial volume from the jukebox position; personal mute.
- Lounge TV: screen share target; sitting on the couch auto-focuses it.
- Elevator: door animation, floor panel.
- Reception desk: PM robot home; interacting opens the brief and PM chat.

## 10. Feature set and milestones

### M0 Foundations
Monorepo, CI (typecheck, lint, unit tests), Compose skeleton, Better Auth with invite links, SQLite + Drizzle migrations, Colyseus BuildingRoom with avatars walking in a lobby placeholder scene, GDT-styled HUD shell.

### M1 Agents at desks (single floor)
Add a floor from a GitHub repo (clone into workdir). Runner backends (`linux-user`, `docker`). Spawn Claude Code and Codex at a desk with prompt + model; tmux + PTY bridge; live terminal modal; laptop textures; status ladder; robot animations from actions; stop/resume/send-home; per-agent worktrees based on `origin/<default>` after `git fetch`; one-click PR. Credential onboarding: Codex device code in UI; Claude `/login` inside the user's terminal; API/plan key entry (encrypted).

### M2 Floors and boards
Elevator + quick menu; floor templates and palettes; issue and PR boards with GitHub App/PAT sync and webhooks/polling; carry-a-card; task queue with concurrency; changes panel (diff/commit/push); services discovery and proxy; usage tracker (Claude statusline forwarder, Codex rate limits, transcript scan); notifications (desktop + tab badge, Slack/Discord webhook).

Also in M2: merge gong + confetti with robots dancing on PR merge; search across chat and all persisted terminal scrollback with jump-to-desk; changes window per robot (live diff vs merge-base, per-file diff, commit, discard, push + PR).

### M3 Collaboration
Whiteboard (Excalidraw + Yjs); wall pictures; jukebox; LiveKit screen share to lounge TV and proximity voice chat (both under the Compose `media` profile); text chat; whereabouts / walk-to-teammate; emotes; sitting. Meeting room: 2-5 robots collaborate on one task in a pattern (debate, lead + team, map-reduce, red/blue, review panel) with a shared worktree, round and token budgets, output committed on a branch or posted as a PR review.

### M4 More providers
OpenCode (serve + attach), Gemini CLI and Kimi Code via ACP, base-URL profiles for DeepSeek / Z.AI / Kimi plan applied to Claude/Codex/OpenCode; custom executable. Board kiosk agents: small restricted robots standing at the issue, PR and queue boards that brief the visitor and can enqueue tasks (implemented as PM-robot sub-tasks where the PM is configured, otherwise as standalone restricted agents).

### M5 PM robot
Engine: Hermes Agent first, behind a `PmEngine` interface so OpenClaw can be added later. Config accepts either `managed` (the office runs a dedicated Hermes profile inside the VM with office-scoped tools and cron) or `external` (gateway URL + token of an existing Hermes instance). Office-scoped toolset exposed to the PM via a REST API with a scoped service token. Privilege presets: `observer` (read + briefs), `coordinator` (default: read everything, enqueue tasks, comment on issues/PRs, deliver briefs; cannot spawn or stop robots), `manager` (coordinator plus spawn/stop within a per-day cap). Daily brief on cron delivered at reception when the owner arrives and optionally to Slack/Telegram. Patrol route, visits waiting robots, answers questions at reception.

### M6 Polish and "tycoon" layer
Weather and day-night cycle, coffee machine buff, office dog per floor, holiday themes, achievements and trophy shelf, rooftop bar (DJ stage, synth music, drinks), arcade cabinet with spectator screen and high scores, floor upgrades as projects grow (template tier changes), optional tycoon build mode for furniture placement. Dropped by owner decision: building exterior/tower, garage with cars, ladders and fire poles, balcony smoke break.

### Ops (across milestones)
Desktop notifications + tab badge for waiting robots (M2). Slack / Discord / Telegram webhook notifications on needs-input, done, PR merged (M2). Self-upgrade from the admin UI: check GitHub releases, pull image, restart; robots survive in tmux (M5). One-command VPS deploy script targeting Hetzner / generic Ubuntu via cloud-init: installs Docker, runs Compose with Caddy and a domain (M2).

## 11. Non-functional requirements
- Performance: 60 fps on a 2020 laptop iGPU at 1080p with 20 robots on screen; ≤ 2 live DOM panels; 1x pixel ratio default; hidden tab pauses rendering.
- Security: all state changes authorised server-side by role and floor access; terminal control gated per D12; Origin checked on WS; uploads validated by magic bytes; image proxy disabled by default (uploads only); rate limits on auth; audit log for spawn/stop/approve/credential changes; secrets encrypted at rest; agents never receive another human's env.
- Reliability: tmux keeps agents alive across office-server restarts; agents re-adopted on boot; resume by provider session id after VM reboot; SQLite WAL + nightly backup script.
- Accessibility: all panels keyboard-navigable; reduced-motion setting disables bubbles/confetti.
- Observability: structured logs (pino), `/healthz`, Prometheus metrics (`/metrics`), per-agent event log viewer.
- Tests: unit (adapters, status ladder, layout/nav, jukebox sync math, secrets), integration (spawn a fake agent CLI in tmux, drive PTY, assert status), e2e (Playwright: login, add floor, spawn, open terminal, elevator).

## 12. Art direction (summary; full reference in research 03)
- Cream `#FFF6D9` viewport with radial vignette. True isometric (ortho, yaw 45°, pitch 35.264°). Dollhouse rooms: two full back walls, front stub walls with dark grey cap, project name on the exterior stub.
- No outlines. `MeshToonMaterial` 3-4 step ramp, hemisphere + one directional key from upper-left, soft contact shadows, baked/SSAO AO, no specular, grime decal at 10-15% on walls/floors.
- Palettes from GDT (teal/cream, oak/sky-blue/orange, lime/mustard/orange/crimson). HUD accents: amber `#F5A623`, cyan `#2DBFE8`, blue `#1E6FE0`, orange-red `#F26522`, crimson `#B83159`, navy `#01008C`.
- UI: Open Sans, white rounded panels with 1 px grey border, golden-bordered `#F5C542` modals on `#FFF9EF` with cream glow, orange gradient primary buttons, red destructive.
- Characters: cute round-headed low-poly robots (Quaternius base), ~4.5 heads tall, toon-shaded, status antenna bulb. Furniture from Kenney Furniture Kit / KayKit (CC0) restyled to GDT proportions and colours.
- Attribution manifest in `packages/assets/ATTRIBUTION.md` for any CC-BY asset.

## 13. Open-source project setup
- License: MIT.
- `README.md` with 5-minute Compose quickstart; `CONTRIBUTING.md`; `CODE_OF_CONDUCT.md`; ADRs in `docs/adr/`; issue templates; CI on PRs; release per tag with Compose image publish to GHCR.
- Attribution to AgentSystemLabs/agent-office (MIT) for any copied code (protocol shapes, PTY host ideas) in `NOTICE`.

## 14. Decision record (owner, 2026-09-28)

| # | Decision | Choice |
|---|---|---|
| D1 | License | MIT |
| D2 | Credential model | Per-user credentials in isolated runners; no shared subscription credentials; admin may add opt-in office-wide API keys for metered providers, attributed to `office` |
| D3 | PM robot engine | Hermes Agent first behind a `PmEngine` interface; config supports `managed` profile in the VM or `external` gateway URL + token; OpenClaw later |
| D4 | PM default privileges | `coordinator` |
| D5 | Voice | Proximity voice chat ships with screen share in M3 (LiveKit, optional profile) |
| D6 | Runner backend | Both: Docker runner per human (Compose default) and Linux user per human (bare-install default) behind one interface |
| D7 | Floor model | Floor = project with 1..n repos; desks/worktrees/boards bind to a repo |
| D8 | Floor layout | Fixed templates in size tiers (small/medium/large); build mode in M6 |
| D9 | Game-y extras | All kept: merge gong + confetti (M2), meeting room patterns (M3), dog/coffee/weather/holidays/achievements/rooftop bar/arcade (M6). Building exterior, garage, ladders/poles, smoke break dropped |
| D10 | More features | Board kiosk agents, search across chat + scrollback, changes window all kept |
| D11 | Hosting target | Hetzner / generic Linux VPS; Compose + Caddy + Let's Encrypt on a public domain |
| D12 | Terminal ACL | Members watch all robots; control = owner of the robot or admin/owner; viewers watch only |
| D13 | Budgets | Show usage only; no enforced caps (revisit later) |
| D14 | GitHub auth | GitHub App via manifest flow with webhooks; fine-grained PAT fallback with polling |
| D15 | Ops extras | Desktop notifications + tab badge; Slack/Discord/Telegram webhooks; self-upgrade from admin UI; one-command VPS deploy script |
| D16 | Repo | Public from day one at github.com/regulus-advanced-systems/regulus-office |

Still open (non-blocking, defaults applied): product name stays "Regulus Office"; UI language English only for now.
