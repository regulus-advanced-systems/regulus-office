# Regulus Office: Specification (draft v0.1, 2026-09-28)

Status: v0.5, decisions resolved with the owner on 2026-09-28 and updated 2026-09-29, 2026-09-30 and 2026-10-01 (see §14; v0.4 replaced the building of floors with the compound, #170; v0.5 renames floors to operations and robots to henchmen everywhere, D24). Agents building from this document should treat it as authoritative. Research backing these decisions lives in `docs/research/`.

## 1. Vision

Regulus Office is an open-source, self-hosted, multiplayer office simulator in the browser. The office is a secret-lair compound dug into an island mountain, in the style of the 1960s spy-villain lair builders (the Evil Genius genre): rock-cut halls, steel blast doors, corridors, a lobby that opens onto the beach. The humans are geniuses; the employees are real AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode, Kimi Code, and any model reachable through them such as DeepSeek, Z.AI GLM, Kimi) rendered as henchmen in yellow jumpsuits sitting at desks and typing on laptops. Each project gets its own room, built into the compound when the project is added. Humans from the same company log in, see each other, share a whiteboard, a jukebox, a screen, GitHub boards and a task queue, and spawn or manage agents from any free desk. Persistent office agents walk the office too: a company project-manager agent that tracks progress, keeps a conference-room overview of every project current, and presents a daily brief, plus personal assistant agents for each human. They run on any supported engine (Hermes Agent, OpenClaw, or a Claude Code / Codex session) and act through the office's own tools.

Design principles:
1. **Real agents, real terminals.** Every henchman is a real CLI process the user can open and drive. Nothing is faked.
2. **Structured by default, terminal on demand.** Status, activity animations, cost and permission prompts come from typed agent events; the raw TUI is one click away.
3. **Per-user credentials, always.** Every human logs into their own providers. The office never stores or shares subscription tokens. This is both a security property and a provider-policy requirement (see research 04).
4. **Room = project.** Navigation maps one-to-one onto the work structure: you walk from the lobby down the corridors into a project's room.
5. **Look like a villain's lair builder, run on a laptop.** Rotatable 3/4 overhead camera, stylised low-poly art, cheap rendering, DOM panels only where needed.
6. **Self-hostable by one person with Docker Compose.** Optional pieces (media SFU, Postgres) are Compose profiles.

## 2. Glossary

| Term | Meaning |
|---|---|
| Office | One deployment (one VM). Has one compound. |
| Compound | The island-mountain lair: the lobby, auto-built corridors, project rooms placed on a grid, special rooms, and the beach outside the blast door. |
| Operation | One project, bound to 1..n git repositories (usually GitHub), with its members, desks, boards, whiteboard, queue and decor. Called an operation everywhere: UI, code, database and protocol (`operations`, `operationId`, `OperationRoom`). Formerly *floor* (renamed 2026-10-01, D24). |
| Room (project room) | An operation's place in the compound: a rectangular grid room with its desks and decor. Room settings change the room (desks, decor style), operation settings change who may use the operation. |
| Lobby | The compound's entrance hall: blast door to the beach, reception, usage tracker wall, jukebox, lounge TV for screen share. Where everyone arrives. |
| Human | A logged-in person with a genius avatar. Roles: `owner`, `admin`, `member`, `viewer`. |
| Henchman / Agent | An AI coding agent process bound to a desk in an operation's room, drawn as a henchman. Owned by the human who spawned it. *Agent* stays the generic term in the protocol and database (`agents`, `agentId`); everything else says henchman. Formerly *robot* (D24). |
| Provider | An agent CLI (Claude Code, Codex, Gemini CLI, OpenCode, Kimi Code) or a model backend routed through one (DeepSeek, Z.AI, Kimi plan). |
| Credential profile | A per-human, per-provider login or key, stored only inside that human's isolated HOME. |
| Desk | A seat with a laptop. Free or occupied by a henchman. |
| Office agent | A long-lived agent with an identity (`soul.md`) and memories that walks the office and acts through the office MCP server: the company PM agent (owned by the office, admin-configured) or a human's personal assistant. Runs on any supported engine. Distinct from the come-and-go coding henchmen at desks. |
| PM agent | The company office agent with the `pm` role. At most one per office. |
| Runner | The sandbox (container or Linux user) in which agents for a given human execute. |
| Session | One agent conversation with a provider session id, resumable. |

## 3. Personas and core loops

- **Ante (owner):** opens the office in a browser in the morning. The PM agent walks up and delivers the daily brief. Ante walks down the corridor into the "primo" room, sees three henchmen working, one with a raised hand (needs permission). Clicks it, the terminal opens, approves, closes. Walks to the issue board, drags issue #42 onto a free desk, picks "Claude Code / opus", the henchman spawns and starts. Puts a picture on the wall. Queues four more issues in the task queue and leaves.
- **Teammate (member):** logs in, is asked once to connect providers. Opens the Codex device-code login in the office UI, then spawns Codex henchmen on the operations they have access to. Shares screen to the lobby TV while discussing a PR on the whiteboard.
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

One Bun process (`office-server`) owns: HTTP (REST + static), the multiplayer room server, the PTY/terminal bridge, the whiteboard sync endpoint, GitHub sync, usage aggregation, the PM agent bridge, and the SQLite database. Agents never run inside this process; they run in runners.

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
        rooms/                 # Colyseus rooms: BuildingRoom, OperationRoom
        agents/                # AgentManager, adapters/, status machine, usage
        terminals/             # tmux + PTY bridge, screen snapshots
        runners/               # runner backends: linux-user, docker
        github/                # App auth, sync, webhooks, board model
        whiteboard/            # y-websocket endpoint, persistence
        jukebox/               # playhead authority, library
        media/                 # LiveKit token minting
        pm/                    # office agents: engines (Hermes/OpenClaw/CLI session), office MCP server, soul/memories, briefs
        db/                    # Drizzle schema, migrations
        secrets/               # envelope encryption for API keys
    web/                       # Vite + React client
      src/
        scene/                 # R3F: cameras, rooms, furniture, henchmen, decals, bubbles
        ui/                    # HUD, panels, dialogs
        net/                   # Colyseus client, terminal WS, yjs provider
        state/                 # zustand stores
        audio/                 # jukebox sync, ambience
  packages/
    protocol/                  # shared TS types + Colyseus schemas + zod validators
    agent-adapters/            # one adapter per provider, pure TS, testable without the server
    room-layout/               # compound grid, corridor routing, room interior generator, nav grid, seats
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
- Office agents (the company PM agent and personal assistants) as long-lived processes: a Hermes/OpenClaw service or a CLI session in a runner, each with its own state; their soul and memories live in the office DB.

## 5. Data model (SQLite, Drizzle)

Core tables (fields abbreviated; every table has `id`, `createdAt`, `updatedAt`):

- `users` (Better Auth) + `user_profiles`: `displayName`, `role`, `avatar` (genius archetype, colours, accessory), `runnerId`, `linuxUid`.
- `invites`: `token`, `role`, `expiresAt`, `usedBy`.
- `operations` (= project rooms): `name`, `slug`, `gridX`, `gridY`, `width`, `depth` (tiles), `doorSide`, `buildState` (`building|ready`), `buildStartedAt`, `deskCount`, `decorStyle`, `archivedAt`. The pre-compound `index`, `paletteId` and `layoutTemplateId` are retired by the compound migration.
- `compound` (one row): grid bounds, lobby placement, blast-door state is live-only. Corridors are derived from room placements, never stored.
- `skin_rules`: `match` (`role:pm`, `office_agent:<id>`, `provider:<id>`), `skinId`, `priority`. Admin-set special henchman skins.
- `operation_repos`: `operationId`, `owner`, `name`, `url`, `defaultBranch`, `workdir`, `isPrimary`. An operation has 1..n repos; desks, worktrees and boards bind to one repo. Boards show all repos of the operation with a repo chip on each card.
- `operation_members`: `operationId`, `userId`, `access` (`manage|spawn|view`).
- `desks`: `operationId`, `seatId` (from layout), `agentId?` (occupied by).
- `agents`: `operationId`, `repoId`, `deskSeatId`, `ownerUserId`, `provider`, `model`, `effort?`, `profileId` (user profile or `office:<provider>`), `status`, `providerSessionId`, `tmuxSession`, `workdir`, `worktreeBranch?`, `taskTitle`, `taskSummary`, `issueNumber?`, `prNumber?`, `lastActivityAt`, `exitedAt`, `spawnArgsJson`.
- `agent_events`: `agentId`, `ts`, `kind` (`status|tool_call|permission_request|message|usage|exit`), `payloadJson`. Rolling retention.
- `credential_profiles`: `userId`, `provider`, `label`, `authKind` (`cli_login|api_key|base_url_key`), `encryptedSecret?` (envelope, only for API keys/plan keys), `baseUrl?`, `modelOverridesJson?`, `verifiedAt`. Subscription OAuth logins are never stored here; they live in the user's HOME written by the unmodified CLI.
- `usage_samples`: `userId`, `agentId?`, `provider`, `ts`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costUsdEstimate`, `source` (`inband|transcript|statusline`).
- `usage_limits`: `userId`, `provider`, `windowKind` (`five_hour|seven_day|monthly|credits`), `usedPct`, `resetsAt`, `observedAt`, `source`.
- `tasks` (queue): `operationId`, `position`, `kind` (`issue|pr|freeform`), `refNumber?`, `prompt`, `provider`, `model`, `effort?`, `autoWorktree`, `state` (`queued|running|done|failed|cancelled`), `agentId?`, `createdBy`.
- `github_issues`, `github_pulls`: cached board data (`number`, `title`, `state`, `labels`, `assignees`, `updatedAt`, `bodyMd`, `checksState`, `reviewState`, `raw`).
- `decor`: `operationId`, `kind` (`picture|poster|plant|...`), `wallId`, `x`, `y`, `w`, `h`, `blobPath`, `placedBy`.
- `whiteboards`: `operationId`, `ydocBlob`, `snapshotPng`, `version`.
- `jukebox_tracks`: `title`, `artist`, `source` (`file|youtube|url`), `ref`, `durationMs`, `addedBy`, `license`.
- `jukebox_state`: `trackId`, `startedAtServerMs`, `pausedAtMs?`, `volume`, `queueJson`.
- `services`: detected dev servers: `agentId`, `pid`, `port`, `url`, `title`, `firstSeenAt`, `lastSeenAt`.
- `pm_briefs`: `ts`, `forUserId?`, `markdown`, `deliveredAt?`.
- `audit_log`: `userId`, `action`, `targetKind`, `targetId`, `metaJson`.

## 6. Wire protocol (packages/protocol)

Two channels plus two side channels:

1. **Colyseus `BuildingRoom`** (one per office): presence of humans (`operationId`, position, heading, animation, `doing`), chat, jukebox state, usage-tracker summary, office agents' positions/state, operation list with per-operation counters (busy/waiting henchmen). Low rate.
2. **Colyseus `OperationRoom`** (one per operation): henchmen on this operation (`HenchmanState`: seat, provider, model, status, action, taskTitle, handRaised, bubbleEmits), desks, decor, task queue, issue/PR board summaries, services, whiteboard snapshot version, carried-card state. Clients join the BuildingRoom always and exactly one OperationRoom at a time.
3. **Terminal WS** `/ws/term/<agentId>` (binary frames): PTY bytes out, keystrokes in, `resize` control frames. Auth checked per connection; `mode=watch|control`.
4. **Yjs WS** `/ws/wb/<operationId>` for the whiteboard.

Client→server commands (Colyseus messages, zod-validated): `move`, `sit`, `emote`, `chat`, `operation.go`, `agent.spawn`, `agent.prompt`, `agent.approve`, `agent.interrupt`, `agent.stop`, `agent.resume`, `agent.sendHome`, `agent.worktree`, `agent.pr`, `queue.add|reorder|cancel`, `card.pick|drop`, `decor.place|move|remove`, `jukebox.play|pause|seek|enqueue|skip`, `screen.share.start|stop`, `pm.ask`.

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

- `linux-user` backend (default for bare-metal/VM installs): `useradd -m office-u-<id>`; agents launched via `systemd-run --uid --gid --scope --unit=agent-<id>` inside that user's tmux server; credential dirs live in that user's HOME (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.kimi-code`, `~/.local/share/opencode`). Each operation repo is cloned once under `/srv/office/projects/<operation>/<repo>` as an office-only mirror that no runner can access. Each human gets their own clone, seeded from the mirror, at `/srv/office/worktrees/<operation>/<runner>/_clones/<repo>`, with their agents' worktrees beside it (`/srv/office/worktrees/<operation>/<runner>/<agent>`); only that human's runner can access that area, so no human's agents can read, write or execute anything from another human's git directory. Each agent gets its own cgroup so process discovery and kill are exact.
- `docker` backend (default in Compose): one long-lived runner container per human built from `runner/Dockerfile` (tmux, git, gh, node, bun, python, uv, the agent CLIs), with the human's credential volume mounted at HOME and only that human's own area of each operation mounted (never the mirror or another human's area). `IS_SANDBOX=1` set so Claude's root guard is satisfied if the image runs as root; prefer a non-root uid. Docker socket is never mounted into runners. Agents needing Docker themselves are an opt-in profile (rootless DinD/sysbox) later.
- Per-agent sandboxes: every coding henchman runs in its own sandbox inside its human's runner identity (a per-agent container in `docker`, a per-agent scope and network namespace in `linux-user`), with its own ports, memory/CPU/pids limits and processes, killed with the agent. Dev servers started by an agent never collide with another agent's, and the office reverse proxy reaches them by agent id.
- Scaling out: more runner hosts are added through the same Runner interface (a remote-host backend, e.g. Hetzner Cloud VMs created on demand and removed when idle). Kubernetes is not used for now.

Credential rules (hard requirements):
1. Subscription OAuth (Claude, ChatGPT) is only ever performed by the unmodified CLI inside the human's own runner. The office renders the login prompt (device code URL/code for Codex; the paste-code terminal for Claude) but never reads, stores or forwards tokens.
2. API keys and plan keys (DeepSeek, Z.AI, Kimi, Gemini, OpenAI/Anthropic keys) are stored encrypted (AES-256-GCM, envelope with `OFFICE_MASTER_KEY`), decrypted only at spawn time, injected as env into that human's agent, never logged, never shown after entry.
3. No office-wide shared *subscription* credentials, ever. An admin MAY add office-wide API keys for metered providers (DeepSeek, Anthropic API, OpenAI API, Gemini API) as an opt-in per provider; members choose per spawn whether to use their own profile or the office key; usage from office keys is attributed to `office` in the tracker.
4. Agents run as the spawning human's runner. Terminal ACL: everyone with access to an operation may watch any henchman's terminal on it; control (typing, approving, prompting, interrupting, resuming, sending home, opening a PR) is reserved to the henchman's owner. Office `admin`s/`owner`s may only emergency-stop another human's henchman (kill the session, keep the branch; audited). Permission request details go only to the henchman's owner. Injected keys are therefore only readable by the human they belong to.

## 9. World: the compound, navigation

### 9.1 Compound
- **Grid.** The compound is a grid of 2 m tiles inside a maximum size (default 64×64 tiles, configurable). The lobby sits at the south edge; its blast door opens onto the beach. Free building: no budget, only the maximum size.
- **Project rooms.** Adding an operation (one or more GitHub repos) opens build mode: the owner picks a size (rectangles from 4×4 to 12×12 tiles), sees a ghost of the room snap to the grid (green valid, red overlapping or unreachable), picks the door side and confirms. The room is then `building` for a short build phase (scaffolding, crates, sparks, dust, construction henchmen; about 20 s, configurable) while the repo clones, and becomes `ready`. Owners and admins build, move and delete rooms; moving needs the room empty of running henchmen; deleting uses operation archive/delete (#150).
- **Corridors.** Derived, never drawn by hand: the server routes a corridor (2 tiles wide) from each room's door to the corridor network rooted at the lobby, reusing existing corridor tiles where it can. A placement is valid only if such a route exists. Corridors are recomputed when rooms are added, moved or removed.
- **Room interiors.** Generated by `packages/room-layout` from the room's size, desk count and decor style (room settings): seats, furniture, wall anchors for boards, pictures and screens, nav blocking and spawn points. A new room starts vanilla: one desk with 4 seats plus a cabinet, a plant, a board wall and a lamp. Room managers add desks (up to what the size fits) and pick a decor style. Seat ids are stable: adding desks never renumbers seats; shrinking or removing desks is refused while their seats are occupied.
- **Special rooms.** Fixed and not buildable: the lobby (reception, usage wall, jukebox, lounge TV, blast door), the conference/war room (M5 content) and a break room with the coffee machine.
- **Access.** A room's members walk in; anyone else in the office sees its closed door with the room's name and henchman counts (working, waiting) but not the interior. Viewers with room access see inside but control nothing (D12).
- **Presence and state.** The building room carries every human's position anywhere in the compound and the compound layout. The client joins the `OperationRoom` of the room the player is in and of up to three nearest visible rooms, for henchmen, boards and laptop screens; state stays bounded no matter how big the compound grows.
- **Outside.** A button on the lobby wall opens the blast door for everyone (shared state, klaxon and warning lights, closes after 60 s). Outside: a strip of beach, a dock and the sea, all walkable. A full island (jungle, paths, volcano, helipad) is later (M6).
- **Quick travel.** Hotkey `F` lists the rooms the player may enter; picking one moves the player to its door. This replaces the elevator.
- **Migration.** Existing floors (now operations) became ready rooms automatically, placed in a row off the main corridor, keeping their repos, desks, henchmen and seats.

### 9.2 Camera and controls
- Default: perspective camera at a 3/4 overhead angle (pitch about 50°), rotatable (`Z`/`C` or right-drag; `E` only interacts, ADR 0007), zoom with the scroll wheel from a compound overview down to a close third-person view behind the player; the camera starts at a room-level framing. Rooms are cutaways: no ceilings, and walls between the camera and the player fade out.
- First-person: perspective camera at eye height, pointer-lock, WASD; toggle with `V` or a HUD button; a 300 ms crossfade.
- Movement: click-to-walk on the compound nav grid (A*), plus WASD relative to the camera's yaw. The player always faces the way they move and turns to follow the cursor when standing.
- Interaction: hover highlights; `E` interacts with the nearest interactable (desk, board, blast-door button, jukebox, whiteboard, TV, picture frame); a radial context menu on right-click.

### 9.3 Characters
- **Humans are geniuses.** Each human picks one of about six original archetypes (for example scientist, tycoon, general, hacker, diva, mastermind) at first login, with colours and accessory choices, changeable later in settings. They wear a floating name plate.
- **Coding agents are henchmen.** Yellow jumpsuits with provider-colour trim (Claude orange, Codex teal, and so on) and a status light whose colour encodes status (grey starting, green idle, blue working, orange waiting-permission with a raised hand, red error, dark exited). Name decals on the ground next to the seat.
- **Special skins.** Office agents (PM, personal assistants, Hermes and others) and any henchman matching an admin rule wear a special skin from a built-in set, assigned in admin settings (`skin_rules`).
- **Animations:** idle, walk, sit-type, sit-idle, read (papers), think (head tilt), celebrate (spin + confetti), facepalm (failing), wave, point. Driven from the action enum. Seated characters sit still when idle and animate only while working.
- **Work bubbles:** while `working`, the laptop emits bubbles: cyan for tool calls, amber for file edits, blue for test runs, orange-red when a tool fails.

### 9.4 In-world objects
- Laptop screens: the focused desk renders live xterm.js in a drei `<Html transform>`; all other desks show a `CanvasTexture` from tmux `capture-pane` text updated ~2/s.
- Issue board and PR board: boards on a room's wall anchors; unfocused = canvas texture; click = 2D panel. Cards can be plucked and carried to a desk (drop = spawn dialog prefilled with the issue).
- Task queue: a clipboard on the wall next to the boards; 2D panel.
- Whiteboard: canvas snapshot on the wall; click = full-screen Excalidraw.
- Picture frames: upload from the user's PC (PNG/JPG/WebP ≤ 10 MB), placed on wall anchors, resizable, removable by placer or admin.
- Usage-tracker wall (lobby, and a small one per room): rendered with Canvas 2D: per-provider bars for the viewer's own limits (5-hour / weekly / credits), today's spend estimate, top henchmen by tokens. Only the viewer's own data plus office totals (never another user's limits).
- Services board: "Running apps" panel listing detected listening ports per henchman with title and an "Open" button that goes through the office's authenticated reverse proxy (`/p/<operation>/a/<agent>/port/<n>/`).
- Jukebox (lobby): queue UI; local files (uploaded, CC-licensed bundled set) with tight sync; YouTube via official iframe as HUD panel with loose sync. Spatial volume from the jukebox position; personal mute.
- Lounge TV: screen share target; sitting on the couch auto-focuses it.
- Blast door: lobby wall button, opening animation, klaxon and warning lights.
- Reception desk: PM agent's home; interacting opens the brief and PM chat.
- Conference room: wall screens with every project's status, tasks across all rooms, a timeline and the PM's daily brief; the PM agent keeps it current. Screens show only what the viewer may see.

## 10. Feature set and milestones

### M0 Foundations
Monorepo, CI (typecheck, lint, unit tests), Compose skeleton, Better Auth with invite links, SQLite + Drizzle migrations, Colyseus BuildingRoom with avatars walking in a lobby placeholder scene, GDT-styled HUD shell.

### M1 Agents at desks (single operation)
Add an operation from a GitHub repo (clone into workdir). Runner backends (`linux-user`, `docker`). Spawn Claude Code and Codex at a desk with prompt + model; tmux + PTY bridge; live terminal modal; laptop textures; status ladder; henchman animations from actions; stop/resume/send-home; per-agent worktrees based on `origin/<default>` after `git fetch`; one-click PR. Credential onboarding: Codex device code in UI; Claude `/login` inside the user's terminal; API/plan key entry (encrypted).

### M2 Operations and boards
Issue and PR boards with GitHub App/PAT sync and webhooks/polling; carry-a-card; task queue with concurrency; changes panel (diff/commit/push); services discovery and proxy; usage tracker (Claude statusline forwarder, Codex rate limits, transcript scan); notifications (desktop + tab badge, Slack/Discord/Telegram webhooks); per-agent sandboxes with their own ports and limits; owner-only henchman control with admin emergency stop (D12). Boards, queue and other wall objects hang on data-driven wall anchors, so they move into compound rooms unchanged.

Also in M2: merge gong + confetti with henchmen dancing on PR merge; search across chat and all persisted terminal scrollback with jump-to-desk; changes window per henchman (live diff vs merge-base, per-file diff, commit, discard, push + PR).

### M2.5 Compound
Replaces the building of floors (now operations, each in its own room) with the compound (§9, D21-D23): compound grid, room placement and build mode with auto-corridors and build animations; room interiors generated from size, desk count and decor style (vanilla start, expandable in room settings); walking the whole compound with a rotatable 3/4 camera and zoom; room access by membership with closed doors for others; quick travel; henchmen with provider trim and status light, special skins by admin rule; genius avatars picked at first login; lobby blast door onto the beach, dock and sea; migration of existing floors into rooms; the lair art kit and HUD restyle; the §11 performance target re-verified with 20 henchmen on screen.

### M3 Collaboration
Whiteboard (Excalidraw + Yjs); wall pictures; jukebox; LiveKit screen share to lounge TV and proximity voice chat (both under the Compose `media` profile); text chat; whereabouts / walk-to-teammate; emotes; sitting. Meeting room: 2-5 henchmen collaborate on one task in a pattern (debate, lead + team, map-reduce, red/blue, review panel) with a shared worktree, round and token budgets, output committed on a branch or posted as a PR review.

### M4 More providers
OpenCode (serve + attach), Gemini CLI and Kimi Code via ACP, base-URL profiles for DeepSeek / Z.AI / Kimi plan applied to Claude/Codex/OpenCode; custom executable. Board kiosk agents: small restricted henchmen standing at the issue, PR and queue boards that brief the visitor and can enqueue tasks (implemented as PM agent sub-tasks where the PM is configured, otherwise as standalone restricted agents).

### M5 Office agents and PM
Office agents: any number of persistent agents, one company PM agent plus personal assistant agents per human (admin-set cap). Engines behind an `OfficeAgentEngine` interface: Hermes Agent (`managed` profile in the VM or `external` gateway URL + token), OpenClaw, or a CLI session engine (a long-running Claude Code / Codex / OpenCode session with a role prompt). Company agents run in an office-owned runner with office-level metered keys only (D2). All office agents act through an office MCP server (with an equivalent REST API) authenticated by a per-agent scoped token; every call is authorised and audited. Personal agents never exceed their owner's rights. Privilege presets: `observer` (read + briefs), `coordinator` (default for the PM: read everything, enqueue tasks, comment on issues/PRs, deliver briefs; cannot spawn or stop henchmen), `manager` (coordinator plus spawn/stop within a per-day cap). Each office agent has a `soul.md` and memories stored by the office (source of truth), with version history; owners/admins read and edit every agent's soul and memories, a human edits their own agents'; memories never store secrets. Conference room with project, task and timeline screens kept current by the PM. Daily brief on cron delivered at reception when the owner arrives and optionally to Slack/Telegram. Patrol route, visits waiting henchmen, answers questions at reception.

### M6 Polish and island
The full island exterior (jungle, paths, volcano, helipad); sky, day-night and weather outside the compound; break-room coffee machine buff; achievements and a trophy vault; room decor packs and furniture placement inside rooms; more special rooms and henchman variety; elastic runner hosts (D18); a performance pass. Dropped by owner decision: office tower, garage with cars, ladders and fire poles, balcony smoke break, and (2026-10-01, with the compound) the office dog, holiday themes, rooftop/lair bar and arcade cabinet.

### Ops (across milestones)
Desktop notifications + tab badge for waiting henchmen (M2). Slack / Discord / Telegram webhook notifications on needs-input, done, PR merged (M2). Self-upgrade from the admin UI: check GitHub releases, pull image, restart; henchmen survive in tmux (M5). Setup on an existing VM: clone the repo and run one setup script (or `docker compose up`) that checks prerequisites, generates secrets, builds or pulls images and starts the office with Caddy and a domain (M2). No VM provisioning.

## 11. Non-functional requirements
- Performance: 60 fps on a 2020 laptop iGPU at 1080p with 20 henchmen on screen; quality presets Low/Medium/High picked automatically from the GPU and changeable in Settings (ADR 0007); ≤ 2 live DOM panels; 1x pixel ratio default; hidden tab pauses rendering.
- Security: all state changes authorised server-side by role and operation access; terminal control gated per D12; Origin checked on WS; uploads validated by magic bytes; image proxy disabled by default (uploads only); rate limits on auth; audit log for spawn/stop/approve/credential changes; secrets encrypted at rest; agents never receive another human's env.
- Reliability: tmux keeps agents alive across office-server restarts; agents re-adopted on boot; resume by provider session id after VM reboot; SQLite WAL + nightly backup script.
- Accessibility: all panels keyboard-navigable; reduced-motion setting disables bubbles/confetti.
- Observability: structured logs (pino), `/healthz`, Prometheus metrics (`/metrics`), per-agent event log viewer.
- Tests: unit (adapters, status ladder, layout/nav, jukebox sync math, secrets), integration (spawn a fake agent CLI in tmux, drive PTY, assert status), e2e (Playwright: login, add a project room, spawn, open terminal, walk between rooms).

## 12. Art direction (summary; full reference in research 03)
- **Genre and target.** A 1960s spy-villain lair dug into an island mountain, as in the Evil Genius games: match that look as closely as possible (D23). Rough-hewn rock walls, poured concrete and steel, riveted blast doors, big control consoles with blinking lamps, retro-futuristic furniture, warm tungsten pools of light against cool rock, red alarm beacons, cable runs and pipes. Spacious and lived-in, never sterile (owner preference): clear zones, warm light, plants, personal clutter at desks.
- **Palette.** Rock greys and browns, concrete, oiled steel; accents: henchman yellow `#F2C200`, alarm red `#D7263D`, console teal `#2EC4B6`, brass `#C9A227`; warm key light, cool fill. Outside: pale sand, turquoise shallows, deep blue sea.
- **Rendering.** Stylised low-poly with vertex colours and `MeshToonMaterial` (3-4 step ramp); hemisphere light + one directional key + a few pooled point lights per visible room; soft contact/blob shadows; no specular; cheap stylised water. Rooms are cutaways with fading near walls. The §11 performance target governs every choice.
- **Characters.** Henchmen: chunky, about 5 heads tall, yellow jumpsuits, cap or helmet, provider trim, status light. Geniuses: bigger exaggerated silhouettes per archetype. All original designs.
- **UI.** Target look: a retro lair control panel (dark panels, brass or yellow frames, stencil headings, lamp-style status chips), restyled in M2.5. Until then the current panels stay.
- **Sources (D23).** Every asset is original (procedural or authored in-repo) or CC0/CC-BY with an entry in `packages/assets/ATTRIBUTION.md`. Good CC0 bases: Quaternius, KayKit, Kenney, Poly Pizza (CC0 only). Screenshots of the genre may be used only as mood references in discussion; never commit, trace or rebuild a commercial game's models, textures, characters, logos, UI or level layouts.

## 13. Open-source project setup
- License: MIT.
- `README.md` with 5-minute Compose quickstart; `CONTRIBUTING.md`; `CODE_OF_CONDUCT.md`; ADRs in `docs/adr/`; issue templates; CI on PRs; release per tag with Compose image publish to GHCR.
- Attribution to AgentSystemLabs/agent-office (MIT) for any copied code (protocol shapes, PTY host ideas) in `NOTICE`.

## 14. Decision record (owner, 2026-09-28; updated 2026-09-29, 2026-09-30 and 2026-10-01)

| # | Decision | Choice |
|---|---|---|
| D1 | License | MIT |
| D2 | Credential model | Per-user credentials in isolated runners; no shared subscription credentials; admin may add opt-in office-wide API keys for metered providers, attributed to `office` |
| D3 | Office agent engines | Office agents (company PM and personal assistants) run on any supported engine: Hermes Agent (`managed` or `external`), OpenClaw, or a Claude Code / Codex session, behind an `OfficeAgentEngine` interface, and act through an office MCP server (updated 2026-09-29) |
| D4 | PM default privileges | `coordinator` |
| D5 | Voice | Proximity voice chat ships with screen share in M3 (LiveKit, optional profile) |
| D6 | Runner backend | Both: Docker runner per human (Compose default) and Linux user per human (bare-install default) behind one interface |
| D7 | Operation model | Operation (formerly floor) = project with 1..n repos, shown as a room in the compound; desks/worktrees/boards bind to a repo; one primary repo, more attachable (2026-09-30, #170) |
| D8 | Room layout | Rooms are grid rectangles (1 tile = 2 m, 4×4 to 12×12 tiles) placed by owners/admins; interiors generated from size, desk count and decor style; start vanilla (one desk of 4 seats plus furniture) (2026-09-30, #170) |
| D9 | Game-y extras | Kept: merge gong + confetti (M2), meeting room patterns (M3), coffee buff, island sky/weather and achievements (M6). Beach outside the blast door in M2.5, full island in M6. Dropped: office tower, garage, ladders/poles, smoke break, and with the compound the office dog, holiday themes, rooftop/lair bar and arcade (updated 2026-10-01) |
| D10 | More features | Board kiosk agents, search across chat + scrollback, changes window all kept |
| D11 | Hosting target | Primary: one central company office on a Hetzner VM (8 vCPU, 16 GB RAM); Compose + Caddy + Let's Encrypt on a public domain. Self-hosting by one person with Compose stays supported (updated 2026-09-29) |
| D12 | Terminal ACL | Everyone with operation access watches all henchmen; only the henchman's owner controls it; admins/owners may emergency-stop it (audited) (updated 2026-09-29) |
| D13 | Budgets | Show usage only; no enforced caps (revisit later) |
| D14 | GitHub auth | GitHub App via manifest flow with webhooks; fine-grained PAT fallback with polling |
| D15 | Ops extras | Desktop notifications + tab badge; Slack/Discord/Telegram webhooks; self-upgrade from admin UI; setup script for an existing VM (no VM provisioning) (updated 2026-09-29) |
| D16 | Repo | Public from day one at github.com/regulus-advanced-systems/regulus-office |
| D17 | Repo isolation | One office-only mirror per operation repo; one clone per human per operation, seeded from the mirror; a runner sees only its own human's area (2026-09-29, #114) |
| D18 | Agent sandboxes | Every coding henchman gets its own sandbox (ports, limits, processes); scale out via remote runner hosts on demand; no Kubernetes for now (2026-09-29, #139) |
| D19 | Floor themes (historical) | Superseded by D21: one compound look; a room's decor style is a room setting (2026-09-30, #170) |
| D20 | Office agent identity | Office agents have `soul.md` and memories stored by the office; owners/admins read and edit all of them, including personal agents', visibly and audited (2026-09-29, #136) |
| D21 | Compound | The office is one island-mountain lair compound. the lobby is the entrance; adding an operation builds a grid room the owner sizes and places; corridors connect rooms automatically; scaffolding and build animations; free building within a maximum compound size; owners/admins build, move and delete rooms, room managers change room settings; special rooms (lobby, conference/war room, break room) are fixed; existing operations migrate to rooms in a row off the main corridor. Camera: rotatable 3/4 overhead with zoom into third-person and first-person (2026-09-30, #170) |
| D22 | Characters | Coding agents are henchmen in yellow jumpsuits with provider-colour trim and a status light; special skins (office agents, PM) from a built-in set, assigned in admin settings. Humans pick one of about six original genius archetypes with colours and accessories at first login, changeable later (2026-09-30, #170) |
| D23 | Art source | Match the genre's look as closely as possible (palette, proportions, materials, lighting, silhouettes), but every asset is original or CC0/CC-BY: no assets, characters, logos, UI or level layouts taken or traced from any commercial game (2026-09-30, #170) |
| D24 | Naming | A repo group with its members, desks and boards is an **operation** (formerly floor); its place in the compound is its **room**. Coding agents are **henchmen** (formerly robots). Applies everywhere: UI, code, database, protocol, REST paths, packages (`@regulus/room-layout`) and docs; *agent* stays the generic protocol/database term (2026-10-01, #222, #226) |

Still open (non-blocking, defaults applied): product name stays "Regulus Office"; UI language English only for now.
