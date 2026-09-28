/**
 * Creates milestones, labels, epics and task issues on GitHub from the plan in docs/SPEC.md.
 * Idempotent: existing milestones/labels/issues (matched by title) are left alone.
 *
 * Usage: bun run scripts/github-issues.ts [--dry-run]
 * Requires: gh CLI authenticated with repo scope.
 */

const REPO = "regulus-advanced-systems/regulus-office";
const DRY = process.argv.includes("--dry-run");

type Area =
  | "server"
  | "web"
  | "protocol"
  | "adapters"
  | "layout"
  | "assets"
  | "infra"
  | "pm"
  | "github"
  | "media"
  | "docs";

interface Issue {
  title: string;
  milestone: string;
  areas: Area[];
  epic?: true;
  body: string;
}

const MILESTONES: Array<{ title: string; description: string }> = [
  { title: "M0 Foundations", description: "Monorepo, CI, auth, DB, multiplayer lobby, GDT-styled HUD shell, avatar walking. SPEC §10 M0." },
  { title: "M1 Agents at desks", description: "Runners, tmux/PTY bridge, Claude Code and Codex at desks, credentials onboarding, worktrees, PRs. SPEC §10 M1." },
  { title: "M2 Floors and boards", description: "Elevator, floor templates, GitHub boards, task queue, changes window, services, usage tracker, notifications, deploy script. SPEC §10 M2." },
  { title: "M3 Collaboration", description: "Whiteboard, wall pictures, jukebox, screen share + voice, chat, emotes, meeting room. SPEC §10 M3." },
  { title: "M4 More providers", description: "OpenCode, Gemini CLI, Kimi Code via ACP, base-URL backends (DeepSeek, Z.AI, Kimi plan), custom executable, board kiosk agents. SPEC §10 M4." },
  { title: "M5 PM robot", description: "Hermes-based project-manager robot: managed or external, daily brief, patrol, privileges; self-upgrade. SPEC §10 M5." },
  { title: "M6 Polish and tycoon layer", description: "Weather, coffee, dog, holidays, achievements, rooftop bar, arcade, floor upgrades, build mode, performance. SPEC §10 M6." },
];

const LABELS: Array<{ name: string; color: string; description: string }> = [
  { name: "type:epic", color: "5319E7", description: "Milestone-level epic tracking a set of tasks" },
  { name: "type:task", color: "0E8A16", description: "Self-contained unit of work for one agent/PR" },
  { name: "area:server", color: "1D76DB", description: "apps/server" },
  { name: "area:web", color: "1D76DB", description: "apps/web" },
  { name: "area:protocol", color: "1D76DB", description: "packages/protocol" },
  { name: "area:adapters", color: "1D76DB", description: "packages/agent-adapters" },
  { name: "area:layout", color: "1D76DB", description: "packages/floor-layout" },
  { name: "area:assets", color: "1D76DB", description: "packages/assets" },
  { name: "area:infra", color: "1D76DB", description: "deploy/, runner/, CI" },
  { name: "area:pm", color: "1D76DB", description: "PM robot (Hermes) bridge" },
  { name: "area:github", color: "1D76DB", description: "GitHub App, boards, webhooks" },
  { name: "area:media", color: "1D76DB", description: "LiveKit, jukebox, audio" },
  { name: "area:docs", color: "1D76DB", description: "docs/, ADRs" },
  { name: "good first issue", color: "7057FF", description: "Small, well-scoped" },
  { name: "needs-decision", color: "D93F0B", description: "Blocked on an owner decision" },
];

const common = (spec: string) => `
**Spec:** ${spec}. Read \`docs/SPEC.md\` and the linked research before starting. The spec is authoritative.

**Definition of done:** code + tests + a short note in the PR on how it was verified; \`bun run lint\`, \`bun run typecheck\`, \`bun test\` green; no secrets or copyrighted assets committed; credential rules in SPEC §8 untouched.`;

const I: Issue[] = [
  // ───────────────────────────── M0 ─────────────────────────────
  {
    title: "Epic: M0 Foundations",
    milestone: "M0 Foundations",
    areas: ["server", "web", "protocol", "infra"],
    epic: true,
    body: `Deliver a running office with humans walking around a lobby: auth, DB, multiplayer, the isometric scene in Game Dev Tycoon style, robot avatars, FPV toggle, HUD shell and CI. No agents yet.
${common("§10 M0, §4, §5, §6, §9, §12")}

Exit criteria: two browsers log in with invite links, see each other walk in the lobby, toggle FPV, chat; Playwright smoke test passes in CI; \`docker compose up\` serves it behind Caddy.`,
  },
  {
    title: "protocol: enums, room state shapes, message unions and zod validators",
    milestone: "M0 Foundations",
    areas: ["protocol"],
    body: `Implement \`packages/protocol\` as the single source of truth for wire types.

Scope:
- Enums: AgentStatus, AgentAction, ProviderId, BackendId, UserRole, FloorAccess, CredentialAuthKind, PmPrivilege (SPEC §6, §5).
- State shapes for BuildingRoom (HumanPresence, floor summaries, jukebox state, PM state) and FloorRoom (RobotState, desks, decor, queue, board summaries, services, carried cards).
- Client→server command union (\`move\`, \`sit\`, \`emote\`, \`chat\`, \`floor.go\`, \`agent.*\`, \`queue.*\`, \`card.*\`, \`decor.*\`, \`jukebox.*\`, \`screen.share.*\`, \`pm.ask\`) with zod schemas.
- AgentEvent union used by adapters.
- Colyseus \`@colyseus/schema\` classes for room state, generated from or kept in lockstep with the TS types.
- Unit tests for validators.
${common("§5, §6, §7")}`,
  },
  {
    title: "server: Bun HTTP scaffold, config, logging, /healthz, /metrics, static web serving",
    milestone: "M0 Foundations",
    areas: ["server"],
    body: `Stand up \`apps/server\`: \`Bun.serve\` with a router, typed config from env (\`OFFICE_PORT\`, \`OFFICE_DATA_DIR\`, \`OFFICE_MASTER_KEY\`, ...), pino structured logging, \`/healthz\`, Prometheus \`/metrics\`, serving the built web client, graceful shutdown. Add \`bun run dev\` that runs server + Vite together.
${common("§4, §11")}`,
  },
  {
    title: "server: Drizzle + bun:sqlite schema, migrations, backup script",
    milestone: "M0 Foundations",
    areas: ["server", "infra"],
    body: `Create the Drizzle schema for the SPEC §5 tables (users/profiles, invites, floors, floor_repos, floor_members, desks, agents, agent_events, credential_profiles, usage_samples, usage_limits, tasks, github_issues, github_pulls, decor, whiteboards, jukebox_*, services, pm_briefs, audit_log). WAL mode, busy_timeout, migrations runner on boot, \`scripts/backup.sh\` using \`sqlite3 .backup\`. Keep the Postgres path open (no SQLite-only SQL in app code).
${common("§5, research 01 §9")}`,
  },
  {
    title: "server: Better Auth with email+password, GitHub login, roles, invite links, first-user-owner",
    milestone: "M0 Foundations",
    areas: ["server"],
    body: `Integrate Better Auth on bun:sqlite. Email+password and GitHub social login. Roles owner/admin/member/viewer. First registered user becomes owner. Admin-generated single-use invite links (7-day expiry) that set the role. Session cookie checked on WebSocket upgrade with Origin check. Rate limit login and invite endpoints. Audit log entries for role changes and invites.
${common("§4.2, §11, research 01 §8")}`,
  },
  {
    title: "server: Colyseus BuildingRoom on Bun with presence, move, chat; RoomTransport interface",
    milestone: "M0 Foundations",
    areas: ["server", "protocol"],
    body: `Add Colyseus with \`@colyseus/bun-websockets\`. Implement BuildingRoom: join with auth, HumanPresence schema, \`move\` at ≤20 Hz relayed to others, \`chat\` persisted (last 1000 lines), floor list with counters. Wrap Colyseus behind a small \`RoomTransport\` interface so a raw Bun WebSocket implementation can replace it (document the fallback in an ADR). Load test with 20 simulated clients.
${common("§6, research 01 §2")}`,
  },
  {
    title: "web: Vite + React + R3F scaffold, zustand stores, routing, Colyseus client",
    milestone: "M0 Foundations",
    areas: ["web"],
    body: `Create \`apps/web\`: Vite, React 19, @react-three/fiber, drei, zustand. Routes: /login, /join/:token, /office. Colyseus client wrapper that patches room state into zustand. Reconnect with backoff. Environment-based server URL.
${common("§4.2, §4.3")}`,
  },
  {
    title: "web: lobby scene in Game Dev Tycoon style (ortho camera, cream vignette, dollhouse room, toon shading)",
    milestone: "M0 Foundations",
    areas: ["web", "assets"],
    body: `Render the lobby from a floor template: orthographic camera at yaw 45°, pitch 35.264°, fixed yaw, limited zoom; \`#FFF6D9\` backdrop with radial vignette; room with two full back walls and front stub walls with dark cap; MeshToonMaterial with 3-4 step ramp; hemisphere + directional key from upper-left; soft contact shadows; grime decal at 10-15% on walls/floors; no outlines. Placeholder furniture from Kenney Furniture Kit (CC0) with entries in ATTRIBUTION.md if any CC-BY. Runs at 60 fps on an iGPU laptop at 1080p.
${common("§9.2, §12, research 03 §8")}`,
  },
  {
    title: "web: click-to-walk and WASD movement on a nav grid with A*, remote avatar interpolation",
    milestone: "M0 Foundations",
    areas: ["web", "layout"],
    body: `Nav grid (0.25 m) generated from template obstacles; A* pathfinding; click on floor to walk; WASD relative to the iso camera; send \`move\` at ≤20 Hz when moved; interpolate remote humans; footstep sound hook.
${common("§9.2, §9.3")}`,
  },
  {
    title: "web: robot avatar (Quaternius LowPoly Robot), toon material, idle/walk/sit animations, colour sets, name plates",
    milestone: "M0 Foundations",
    areas: ["web", "assets"],
    body: `Import the Quaternius Animated LowPoly Robot (CC0) as GLB into \`packages/assets\`; apply toon material; wire idle/walk/sit/wave/dance clips via drei useAnimations; per-user colour set + accessory; floating name plate for humans; \`<Clone>\` for many instances; verify 20 robots on screen at 60 fps.
${common("§9.3, research 03 §9")}`,
  },
  {
    title: "web: first-person view toggle (perspective camera, pointer lock, full front walls, crossfade)",
    milestone: "M0 Foundations",
    areas: ["web"],
    body: `Toggle with \`V\` and a HUD button. Perspective camera at robot eye height, PointerLockControls, WASD, collision against template obstacles; front stub walls swap to full walls in FPV; 300 ms crossfade; reduced-motion setting respected.
${common("§9.2")}`,
  },
  {
    title: "web: HUD shell and dialog components in Game Dev Tycoon UI style",
    milestone: "M0 Foundations",
    areas: ["web"],
    body: `Design tokens (colours from SPEC §12, Open Sans), top bar (office name, floor name, clock), top-right status box, panel and modal components (golden border #F5C542 on #FFF9EF with cream glow, round X button, orange gradient primary, red destructive), toast notifications, settings panel skeleton, keyboard navigation and focus trapping. Storybook-free: a /ui-kit dev route showing every component.
${common("§12, research 03 §5")}`,
  },
  {
    title: "floor-layout: template schema, Lobby template, tier templates (small/medium/large), nav grid, tests",
    milestone: "M0 Foundations",
    areas: ["layout"],
    body: `Define FloorTemplate (size, wallHeight, seats, wallAnchors, obstacles, spawn, elevator) and Palette types. Author the Lobby template (elevator bank, reception desk, usage wall, lounge with TV, jukebox spot, whiteboard, coffee machine) and the "Office L2" medium template modelled on GDT's second office (shared table with seats, CEO L-desk, cabinets, kitchenette, meeting table), plus small and large variants. Nav grid generator with tests. Palettes per research 03.
${common("§9.1, research 03 §4")}`,
  },
  {
    title: "server: secrets module with AES-256-GCM envelope encryption under OFFICE_MASTER_KEY",
    milestone: "M0 Foundations",
    areas: ["server"],
    body: `Implement encrypt/decrypt for credential_profiles: random DEK per secret, AES-256-GCM with 12-byte nonce and AAD \`userId|secretName\`, DEK wrapped by the master key, stored as {ciphertext, nonce, wrappedDEK, keyVersion}. Key rotation re-wraps DEKs. Never log plaintext. Unit tests incl. tamper detection.
${common("§8, research 01 §8")}`,
  },
  {
    title: "infra: Compose dev profile, seed script, Playwright smoke test in CI",
    milestone: "M0 Foundations",
    areas: ["infra"],
    body: `Make \`docker compose up\` (base profile) serve the office behind Caddy on localhost; \`scripts/seed.ts\` creates an owner and an invite; Playwright e2e: register owner, create invite, second context joins, both walk, chat arrives. Run in CI. Publish images to GHCR on tags.
${common("§4.2, §11")}`,
  },

  // ───────────────────────────── M1 ─────────────────────────────
  {
    title: "Epic: M1 Agents at desks",
    milestone: "M1 Agents at desks",
    areas: ["server", "adapters", "web", "infra"],
    epic: true,
    body: `First real robots: spawn Claude Code and Codex at a desk on a single floor, watch them work, open their terminal, approve permissions, resume, send home, get a PR. Per-user runners and credential onboarding.
${common("§10 M1, §7, §8")}

Exit criteria: a member connects Codex via device code in the UI and Claude via \`/login\` inside their own terminal; spawns one of each on a floor cloned from GitHub; robots animate by action; a raised hand opens a permission prompt; one-click PR appears on GitHub; office-server restart does not kill robots.`,
  },
  {
    title: "server: Runner interface and linux-user backend (per-human Linux user, systemd-run scopes, tmux per human)",
    milestone: "M1 Agents at desks",
    areas: ["server", "infra"],
    body: `Define \`Runner\` (provision(user), exec(plan) → tmux session, attach(session, mode), listProcesses(agent), kill(agent), mountProject(floorRepo)). Implement linux-user backend: \`useradd -m office-u-<id>\`, per-human tmux server socket under /run/office/tmux/, agents launched via \`systemd-run --uid --gid --scope --unit=agent-<id>\`, project workdirs group-accessible, cgroup-based process listing. Document sudoers requirements. Integration test with a fake agent script.
${common("§8, research 01 §10, §12; research 04 §5")}`,
  },
  {
    title: "server: Runner docker backend (one runner container per human, credential volume, workdir mounts)",
    milestone: "M1 Agents at desks",
    areas: ["server", "infra"],
    body: `Implement the docker backend using \`runner/Dockerfile\`: create/start one container per human with a named credential volume at HOME, floor workdirs bind-mounted, non-root uid, \`IS_SANDBOX=1\`; tmux sessions via \`docker exec\`; process/port listing inside the container's net namespace; never mount the Docker socket into runners. Compose wiring. Integration test with a fake agent.
${common("§8, research 01 §10")}`,
  },
  {
    title: "server: terminal bridge (Bun PTY → tmux attach, per-viewer WebSocket, watch/control ACL, scrollback on join)",
    milestone: "M1 Agents at desks",
    areas: ["server"],
    body: `\`/ws/term/<agentId>?mode=watch|control\`: auth + ACL per SPEC D12 (members watch all; control = owner/admin); spawn \`tmux attach\` (read-only for watch) in a Bun terminal; binary frames both ways; resize control frames; fixed virtual size 160x45 by default; send \`capture-pane -S -2000\` scrollback on join; persist scrollback to disk every 15 s for search; fallback to bun-pty if Bun PTY fails. Load test with 5 viewers on one session.
${common("§6, §11, research 01 §3")}`,
  },
  {
    title: "web: xterm.js terminal modal and laptop screen textures from capture-pane",
    milestone: "M1 Agents at desks",
    areas: ["web"],
    body: `Terminal modal with @xterm/xterm + fit + webgl addons, watch/control indicator, viewer faces, "X is typing"; focused desk renders live terminal in a drei \`<Html transform occlude="blending">\` on the laptop; all other desks show a CanvasTexture rendered from tmux text at ~2 fps. At most 2 live DOM panels.
${common("§9.4, research 01 §1, §7")}`,
  },
  {
    title: "server: AgentManager lifecycle state machine, persistence, re-adopt on boot, event log",
    milestone: "M1 Agents at desks",
    areas: ["server", "protocol"],
    body: `Own the agent lifecycle: spawn → starting → idle/working/waiting_* → done/error/exited. Persist agents and provider session ids; on boot re-adopt live tmux sessions and mark the rest offline; append AgentEvents to agent_events with rolling retention; publish RobotState into FloorRoom; status derivation ladder (structured → hooks → OSC title → capture-pane regex).
${common("§7, research 04 §3")}`,
  },
  {
    title: "adapters: Claude Code (tmux TUI + http hooks + statusline forwarder, resume, base-URL profiles)",
    milestone: "M1 Agents at desks",
    areas: ["adapters"],
    body: `Spawn the unmodified \`claude\` binary in the human's runner with a generated \`--settings\` file registering http hooks (Notification, Stop, PermissionRequest, PreToolUse, PostToolUse, UserPromptSubmit, SessionStart) to the office hook URL with a per-agent token; statusline command that forwards the JSON (cost, context_window, rate_limits) to the office; map hook events to AgentStatus/AgentAction; \`--resume\`; env injection for base-URL profiles (DeepSeek/Z.AI/Kimi) and API keys; never read or store OAuth credentials; document that users run \`/login\` themselves. Unit tests with recorded hook payloads.
${common("§7, §8, research 04 §1.1, §6")}`,
  },
  {
    title: "adapters: Codex (app-server JSON-RPC client, threads, approvals, device-code login, rate limits, TUI attach)",
    milestone: "M1 Agents at desks",
    areas: ["adapters"],
    body: `Drive \`codex app-server\` over stdio (or a per-human unix socket daemon): initialize, thread/start|resume, turn/start|interrupt, item/*/requestApproval → AgentEvent permission_request, item/agentMessage/delta, thread/tokenUsage/updated, account/rateLimits/read|updated, account/login/start {chatgptDeviceCode} → {verificationUrl,userCode}; generate typed bindings with \`codex app-server generate-ts\`; TUI attach via \`codex resume <id>\` in tmux (hand-off, not co-drive). Unit tests against recorded JSON-RPC traces.
${common("§7, research 04 §1.2")}`,
  },
  {
    title: "web: spawn dialog, desk interaction, status antenna, action animations, raised hand, work bubbles",
    milestone: "M1 Agents at desks",
    areas: ["web"],
    body: `\`E\` at a free desk opens the spawn dialog (provider, credential profile, model, effort, prompt, issue prefill). Robot sits at the seat; antenna bulb colour by status; actions map to clips (typing, reading papers, thinking, failing facepalm, celebrating spin + confetti); raised hand + ding for waiting_permission; GDT-style bubbles emitted from the laptop while working (cyan tool calls, amber edits, blue tests, orange-red failures) flying to floor HUD counters; floor-decal name labels.
${common("§9.3, §9.4, research 03 §4")}`,
  },
  {
    title: "server+web: floors bound to GitHub repos (clone), floor_repos, membership, FloorRoom state",
    milestone: "M1 Agents at desks",
    areas: ["server", "web", "github"],
    body: `Add floor: name, palette, template tier, one or more repos (owner/name via GitHub App/PAT or public URL); clone into /srv/office/projects/<floor>/<repo>; floor_members with manage/spawn/view; FloorRoom with robots, desks, decor; client joins exactly one FloorRoom; floor name painted on the exterior stub wall.
${common("§5, §6, §9.1, D7")}`,
  },
  {
    title: "server: git worktrees per agent (fetch, base on origin/default), cleanup, prune, one-click PR",
    milestone: "M1 Agents at desks",
    areas: ["server", "github"],
    body: `Before creating a worktree always \`git fetch\` and base on \`origin/<default>\` (agent-office issue #119 lesson). Branch \`office/<agent-slug>\`. Cleanup dialog on send-home (keep/delete branch). \`prune\` command. One-click PR: push + create PR with drafted title/body and \`Closes #n\`, using the project credential (App installation token or deploy key), never a user's PAT.
${common("§10 M1, research 02 weaknesses #7")}`,
  },
  {
    title: "web+server: credential profiles panel (Codex device code, Claude /login guidance, encrypted API/plan keys, verification)",
    milestone: "M1 Agents at desks",
    areas: ["web", "server"],
    body: `"Connect providers" panel: Codex shows verificationUrl + userCode from the adapter and polls; Claude opens a terminal in the user's runner running \`claude auth login\` with instructions (paste-code fallback) and detects success by the CLI's own status, never reading the token; API key / base-URL profiles for DeepSeek, Z.AI, Kimi plan, Gemini key, OpenAI/Anthropic keys stored via the secrets module with a verify call; admin-only office API keys per D2; audit log entries.
${common("§8, D2, research 04 §5, §6")}`,
  },
  {
    title: "server+web: agent controls (prompt, approve/deny, interrupt, stop, resume, send-home animation)",
    milestone: "M1 Agents at desks",
    areas: ["server", "web"],
    body: `Commands \`agent.prompt\`, \`agent.approve\`, \`agent.stop\`, \`agent.resume\` with ACL; permission prompt UI from AgentEvent permission_request; interrupt sends SIGINT/adapter interrupt; send-home walks the robot to the elevator carrying a box then frees the desk; resume re-spawns with the provider session id.
${common("§6, §7")}`,
  },

  // ───────────────────────────── M2 ─────────────────────────────
  {
    title: "Epic: M2 Floors and boards",
    milestone: "M2 Floors and boards",
    areas: ["server", "web", "github"],
    epic: true,
    body: `Multiple floors with an elevator, GitHub issue/PR boards, task queue, changes window, running-apps discovery, usage tracker wall, search, notifications, merge gong, and a one-command VPS deploy.
${common("§10 M2")}

Exit criteria: three projects on three floors; issue dragged from the board onto a desk spawns a robot; queue runs three issues with concurrency 2; PR merge rings the gong; usage wall shows the viewer's Claude and Codex windows; office deployed on a Hetzner VM with one command.`,
  },
  {
    title: "web+server: elevator with floor panel, quick menu teleport, per-floor palettes and template tiers",
    milestone: "M2 Floors and boards",
    areas: ["web", "server", "layout"],
    body: `Elevator object with door animation and a floor panel listing floors with name, colour chip and working/waiting counts; 1.5 s ride; \`F\` quick menu teleports; \`floor.go\` switches FloorRoom; palettes cycle per floor; template tier upgrade flow when desks run out (owner confirms).
${common("§9.1, §9.4, D8")}`,
  },
  {
    title: "server: GitHub App integration (manifest setup, installation tokens, webhooks, polling, PAT fallback, issue/PR cache)",
    milestone: "M2 Floors and boards",
    areas: ["server", "github"],
    body: `Setup page creates a GitHub App through the manifest flow; store app id/private key/webhook secret; installation tokens via octokit; webhook endpoint with signature verification for issues, pull_request, check_suite, pull_request_review; polling mode (ETag conditional, 30-60 s) when webhooks are unavailable; fine-grained PAT fallback; cache into github_issues/github_pulls; push board summaries into FloorRoom.
${common("§4.2, D14, research 01 §11")}`,
  },
  {
    title: "web+server: issue board and PR board (cork boards, panels, carry-a-card, assign, comment, merge/close)",
    milestone: "M2 Floors and boards",
    areas: ["web", "server", "github"],
    body: `Cork boards on wall anchors (Open / In progress / Closed; Draft / In review / Approved / Merged / Closed with CI status); unfocused = canvas texture, click = GDT-style panel with markdown body and comments (sanitised); pluck a card and carry it (visible to all) and drop on a desk to prefill spawn; assign on GitHub; comment; merge (squash/merge/rebase) and close for users with floor manage; repo chip per card for multi-repo floors.
${common("§9.4, D7")}`,
  },
  {
    title: "server+web: task queue (issue/PR/freeform tasks, concurrency, reorder, retry, auto-worktree, PR linking, wall clipboard)",
    milestone: "M2 Floors and boards",
    areas: ["server", "web"],
    body: `Queue model per floor; runner picks the next task when a desk and the concurrency slot are free; spawns with the task's provider/model/profile; auto-worktree; links the PR when it appears; states queued/running/done/failed/cancelled; reorder, retry, cancel; clipboard object on the wall + panel; survives restarts.
${common("§5, §9.4")}`,
  },
  {
    title: "server+web: changes window per robot (live diff vs merge-base, per-file diff, commit, discard, push + PR)",
    milestone: "M2 Floors and boards",
    areas: ["server", "web"],
    body: `Poll \`git status\`/diff in the robot's worktree every 2 s while open; file tree; per-file diff viewer; commit with message; discard file; push + PR; image previews; ACL: owner/admin.
${common("§10 M2, D10")}`,
  },
  {
    title: "server+web: services discovery (cgroup + /proc/net scan) and authenticated proxy with Running apps panel",
    milestone: "M2 Floors and boards",
    areas: ["server", "web"],
    body: `Every 2-3 s while agents are active: list LISTEN sockets in each agent's cgroup / container net namespace, map to pid and title (fast path: URLs in PTY output); services table; \`/p/<floor>/port/<n>/\` reverse proxy with auth and WebSocket upgrade rewriting; "Running apps" panel with Open buttons; note Vite \`base\` caveat and per-port subdomain mode.
${common("§9.4, research 01 §12")}`,
  },
  {
    title: "server+web: usage tracker (usage_samples/limits, Claude statusline, Codex rate limits, transcript scan, lobby wall)",
    milestone: "M2 Floors and boards",
    areas: ["server", "web"],
    body: `Aggregate usage from adapter in-band events, the Claude statusline forwarder, Codex \`account/rateLimits\`, and a periodic ccusage-style transcript scan inside each runner (dedupe by message id); price table for estimates; lobby wall (Canvas 2D texture) and a small per-floor display showing the viewer's own windows (5-hour / weekly / credits), today's spend estimate, top robots by tokens, office totals; never another user's limits; no enforcement (D13).
${common("§9.4, D13, research 04 §4")}`,
  },
  {
    title: "server+web: search across chat and persisted terminal scrollback with jump-to-desk",
    milestone: "M2 Floors and boards",
    areas: ["server", "web"],
    body: `SQLite FTS5 over chat and scrollback snapshots (ANSI stripped); \`/\` opens search; results grouped by robot/floor; click walks the avatar to the desk and opens the terminal at the match.
${common("D10")}`,
  },
  {
    title: "server+web: notifications (desktop + tab badge; Slack/Discord/Telegram webhooks)",
    milestone: "M2 Floors and boards",
    areas: ["server", "web"],
    body: `Browser notifications and tab-title badge when a robot needs input or finishes (per-user setting); server-side webhooks (Slack/Discord/Telegram) on needs-input, done, PR merged with a 5 s settle and rate limit; admin config panel.
${common("D15")}`,
  },
  {
    title: "web: merge gong, confetti and robot dance on PR merge",
    milestone: "M2 Floors and boards",
    areas: ["web", "server"],
    body: `MergeWatch emits \`pr.merged\`; gong object rings (Web Audio synth), confetti particles, robots on the floor play the dance clip for 3 s; triple ring when the queue empties; manual bang on interact.
${common("D9")}`,
  },
  {
    title: "infra: one-command VPS deploy script (cloud-init for Hetzner/Ubuntu, Docker, Compose, Caddy TLS)",
    milestone: "M2 Floors and boards",
    areas: ["infra", "docs"],
    body: `\`deploy/vps.sh\` and a cloud-init template: install Docker, clone the release, write .env from prompts (domain, master key), \`docker compose up -d\`, print the claim link. Hetzner example with hcloud CLI; generic Ubuntu path. Docs page for DNS + firewall (80/443, LiveKit ports when media profile is on).
${common("D11, D15")}`,
  },

  // ───────────────────────────── M3 ─────────────────────────────
  {
    title: "Epic: M3 Collaboration",
    milestone: "M3 Collaboration",
    areas: ["web", "server", "media"],
    epic: true,
    body: `Humans working together in the office: whiteboard, wall pictures, jukebox, screen share and voice through LiveKit, chat, emotes, sitting, and the meeting room for multi-robot patterns.
${common("§10 M3")}`,
  },
  {
    title: "web+server: collaborative whiteboard (Excalidraw + Yjs, y-websocket endpoint, persistence, wall snapshot)",
    milestone: "M3 Collaboration",
    areas: ["web", "server"],
    body: `\`/ws/wb/<floorId>\` y-websocket in the Bun server; y-excalidraw binding; Yjs updates persisted in whiteboards; lazy-load Excalidraw; unfocused board shows an \`exportToCanvas\` snapshot texture (throttled 2 s); live cursors and names; building-wide board in the lobby.
${common("§9.4, research 01 §6, §7")}`,
  },
  {
    title: "web+server: wall pictures (upload from PC, place on anchors, resize, remove)",
    milestone: "M3 Collaboration",
    areas: ["web", "server"],
    body: `Upload PNG/JPG/WebP ≤ 10 MB validated by magic bytes; stored on disk; decor rows; aim at a wall anchor and place; resize handles; move/remove by placer or admin; textures loaded via TextureLoader; no remote-URL proxy by default.
${common("§9.4, §11")}`,
  },
  {
    title: "web+server: jukebox (server playhead, clock sync, local files, YouTube HUD, spatial audio, CC tracks)",
    milestone: "M3 Collaboration",
    areas: ["web", "server", "media"],
    body: `jukebox_state with startedAtServerMs; 4-timestamp clock sync; Web Audio playback with playbackRate nudging (<75 ms) or re-seek; queue/skip/volume; upload audio files; bundle 3-5 CC0/CC-BY tracks with attribution; YouTube via the official IFrame API as a HUD panel with loose sync; spatial attenuation from the jukebox position; personal mute; requires the "enter office" click gesture.
${common("§9.4, research 01 §5")}`,
  },
  {
    title: "server+web+infra: LiveKit media profile (token minting, screen share to lounge TV, proximity voice)",
    milestone: "M3 Collaboration",
    areas: ["media", "server", "web", "infra"],
    body: `Compose profile \`media\` with livekit-server and livekit.yaml; server mints tokens; client publishes screen share, rendered on the lounge TV texture (sitting on the couch auto-focuses fullscreen); voice tracks with distance attenuation via PannerNode; mute; speaking mouth animation; docs for UDP ports and TURN.
${common("D5, research 01 §4")}`,
  },
  {
    title: "web+server: text chat, whereabouts, walk-to-teammate, emotes, sitting",
    milestone: "M3 Collaboration",
    areas: ["web", "server"],
    body: `Chat overlay with fading bubbles and history; whereabouts panel with per-human \`doing\` and floor; click a name to walk there (rides the elevator if needed); emote wheel (hold G) with wave/thumbs up/clap/dance/point/facepalm; sit on couches/chairs with synced seat state.
${common("§10 M3")}`,
  },
  {
    title: "server+web: meeting room with multi-robot patterns (debate, lead+team, map-reduce, red/blue, review panel)",
    milestone: "M3 Collaboration",
    areas: ["server", "web"],
    body: `Meeting room object on medium/large templates; start a meeting with 2-5 robots (any providers), a pattern, round and token budgets; shared worktree with a \`.meeting/\` notes dir; orchestrator drives turns through adapters; door sign and wall board show progress; output committed on a branch or posted as a PR review; persisted and resumable.
${common("D9, research 02 feature 56")}`,
  },

  // ───────────────────────────── M4 ─────────────────────────────
  {
    title: "Epic: M4 More providers",
    milestone: "M4 More providers",
    areas: ["adapters"],
    epic: true,
    body: `OpenCode, Gemini CLI, Kimi Code, base-URL backends (DeepSeek, Z.AI, Kimi plan), a custom executable adapter, and board kiosk agents.
${common("§10 M4, §7, research 04")}`,
  },
  {
    title: "adapters: OpenCode (opencode serve per human + SSE events, opencode --attach TUI co-drive, permissions API)",
    milestone: "M4 More providers",
    areas: ["adapters"],
    body: `One \`opencode serve\` per human runner; sessions via REST; \`/event\` SSE → AgentEvents (session.idle, permission.updated, message.part.updated); permissions via \`POST /session/:id/permissions/:id\`; TUI attach with \`opencode --attach\` (true co-drive); provider config injection through \`OPENCODE_CONFIG_CONTENT\`.
${common("research 04 §1.7")}`,
  },
  {
    title: "adapters: ACP client library and Gemini CLI adapter (gemini --acp, API key/Vertex auth, OTLP usage)",
    milestone: "M4 More providers",
    areas: ["adapters"],
    body: `Generic ACP client on \`@agentclientprotocol/sdk\` (stdio JSON-RPC): session/new|load|prompt|cancel, request_permission → AgentEvent, tool_call kinds → AgentAction, usage_update; Gemini CLI adapter with API-key/Vertex env only (consumer OAuth is gone), \`GEMINI_CLI_HOME\`, usage from local OTLP telemetry file; TUI attach via \`gemini --resume\`.
${common("research 04 §1.3, §2")}`,
  },
  {
    title: "adapters: Kimi Code via ACP with device-code login",
    milestone: "M4 More providers",
    areas: ["adapters"],
    body: `\`kimi acp\` through the ACP client; \`KIMI_CODE_HOME\` per human; device-code login driven via PTY with URL/code surfaced in the UI; \`/usage\` and the semi-official usages endpoint as best effort; TUI attach via \`kimi --session\`.
${common("research 04 §1.5")}`,
  },
  {
    title: "adapters+web: base-URL backend profiles (DeepSeek, Z.AI GLM, Kimi plan) applied to Claude Code, Codex and OpenCode spawns",
    milestone: "M4 More providers",
    areas: ["adapters", "web"],
    body: `BackendId profiles carrying base URL, key and model mappings (DeepSeek: ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic + model map; Z.AI: https://api.z.ai/api/anthropic, Codex responses endpoint; Kimi: https://api.kimi.ai/coding/); spawn dialog lets a user pick "Claude Code via DeepSeek"; usage attributed to the backend; best-effort quota reads for Z.AI/Kimi.
${common("§7, research 04 §1.4-1.6")}`,
  },
  {
    title: "adapters: custom executable adapter with heuristic status ladder (OSC title, capture-pane regex, mtime)",
    milestone: "M4 More providers",
    areas: ["adapters"],
    body: `Run any command in tmux; derive status from OSC terminal title, per-agent regex rulesets on \`capture-pane\` (spinners, "proceed?" prompts), and session-file mtime; configurable rules in YAML; document limits.
${common("research 04 §3A")}`,
  },
  {
    title: "server+web: board kiosk agents (Issues/PR/Queue) with restricted tools and briefs",
    milestone: "M4 More providers",
    areas: ["server", "web", "pm"],
    body: `Small restricted robots standing at each board that summarise the board on interaction and can enqueue tasks via an office CLI/REST with a scoped token; implemented as PM sub-tasks when the PM robot is configured, otherwise as standalone agents with disallowed edit tools.
${common("D10, research 02 feature 55")}`,
  },

  // ───────────────────────────── M5 ─────────────────────────────
  {
    title: "Epic: M5 PM robot",
    milestone: "M5 PM robot",
    areas: ["pm", "server", "web"],
    epic: true,
    body: `A Hermes-powered project-manager robot that walks the office, tracks robots/tasks/projects, and delivers a daily brief; managed profile or external gateway; privilege presets; plus self-upgrade from the admin UI.
${common("§10 M5, D3, D4")}`,
  },
  {
    title: "pm: PmEngine interface and Hermes managed profile (install, config, office toolset over REST with scoped token, privilege presets)",
    milestone: "M5 PM robot",
    areas: ["pm", "server"],
    body: `\`PmEngine\` (start, stop, ask, schedule, events). Managed mode installs Hermes into a dedicated profile in the VM (or a container), configures the office toolset (read agents/tasks/boards/usage; enqueue tasks; comment on issues/PRs; spawn/stop only under \`manager\`) as Hermes tools calling the office REST API with a scoped service token; presets observer/coordinator/manager (default coordinator); approvals routed to the owner.
${common("D3, D4, research 04 §1.8")}`,
  },
  {
    title: "pm: external Hermes gateway mode (URL + token), session mapping, health checks",
    milestone: "M5 PM robot",
    areas: ["pm"],
    body: `Connect to an existing Hermes instance over its TUI-gateway JSON-RPC/WebSocket or API server; same PmEngine interface; map office questions to sessions; health indicator in admin panel; document required Hermes config (tools, cron delivery to the office webhook).
${common("D3, research 04 §1.8")}`,
  },
  {
    title: "pm+web: daily brief (cron, delivery at reception on arrival, Slack/Telegram), brief UI and history",
    milestone: "M5 PM robot",
    areas: ["pm", "web", "server"],
    body: `Cron job in Hermes produces a markdown brief (overnight robot activity, PRs merged/opened, queue state, usage, blockers) posted to the office; stored in pm_briefs; when the owner enters the office the PM robot walks to them and presents it in a GDT-style dialog; optional Slack/Telegram delivery; history panel at reception.
${common("§10 M5")}`,
  },
  {
    title: "web+server: PM robot in the world (patrol route, visits waiting robots, reception chat)",
    milestone: "M5 PM robot",
    areas: ["web", "server", "pm"],
    body: `Distinct PM robot model/colour; deterministic-by-clock patrol route across floors via the elevator; walks to robots in waiting_* states; interact at reception or anywhere to ask questions (streams the Hermes answer into a dialog); \`pm.ask\` command.
${common("§9.1, research 02 sync patterns")}`,
  },
  {
    title: "server+web+infra: self-upgrade from the admin UI (release check, image pull, restart, robots survive)",
    milestone: "M5 PM robot",
    areas: ["infra", "server", "web"],
    body: `Admin panel shows current version and latest GitHub release; upgrade pulls the new image and restarts the office container while runners and tmux sessions keep running; re-adopt on boot; rollback note.
${common("D15")}`,
  },

  // ───────────────────────────── M6 ─────────────────────────────
  {
    title: "Epic: M6 Polish and tycoon layer",
    milestone: "M6 Polish and tycoon layer",
    areas: ["web", "server"],
    epic: true,
    body: `Ambience and progression: weather and day-night, coffee buff, office dog, holiday themes, achievements, rooftop bar, arcade, floor upgrades and build mode, performance pass.
${common("§10 M6, D9")}`,
  },
  { title: "web+server: weather and day-night cycle (optional live forecast by city)", milestone: "M6 Polish and tycoon layer", areas: ["web", "server"], body: `Server-authoritative sky state; window light and rain/snow effects visible through windows only (interiors stay GDT-flat); optional open-meteo forecast; setting to pin weather.\n${common("D9")}` },
  { title: "web: coffee machine buff (speed boost, buzz meter, jitters)", milestone: "M6 Polish and tycoon layer", areas: ["web"], body: `Interact with the lobby coffee machine: faster walk for 60 s, buzz meter in HUD, jitter animation after 3 cups; synced so others see the cup.\n${common("D9")}` },
  { title: "web+server: office dog per floor (A* wandering, naps by busy robots, barks at waiting robots, pettable)", milestone: "M6 Polish and tycoon layer", areas: ["web", "server"], body: `Deterministic-by-clock route legs from the server; behaviours keyed to robot states; pet interaction; nameable per floor.\n${common("D9, research 02 feature 16")}` },
  { title: "web: holiday themes (auto by calendar, admin override)", milestone: "M6 Polish and tycoon layer", areas: ["web"], body: `Decor swaps and robot accessories for a few holidays; building-wide; toggle in settings.\n${common("D9")}` },
  { title: "server+web: achievements and trophy shelf", milestone: "M6 Polish and tycoon layer", areas: ["server", "web"], body: `Office-wide achievements (first PR merged, 100 issues closed, all providers connected, ...) unlocked from events; trophy shelf object in the lobby; toast on unlock.\n${common("D9")}` },
  { title: "web: rooftop bar (DJ stage, synth music, lights, drinks)", milestone: "M6 Polish and tycoon layer", areas: ["web", "media"], body: `Rooftop floor reachable by elevator; synthesized music (Web Audio) synced by clock; lights; drinks with a mild post-process effect; opt-in and off by default on low-end devices.\n${common("D9, research 02 feature 17")}` },
  { title: "web+server: arcade cabinet with spectator screen and high scores", milestone: "M6 Polish and tycoon layer", areas: ["web", "server"], body: `Falling-blocks game on the cabinet; spectators see the player's frames on the cabinet texture; pauses when the player's robot needs input; persistent high-score table.\n${common("D9, research 02 feature 20")}` },
  { title: "web+server: floor tier upgrades and tycoon build mode (furniture placement)", milestone: "M6 Polish and tycoon layer", areas: ["web", "server", "layout"], body: `Upgrade a floor's template tier with a move-in animation; build mode lets floor managers place/move furniture from a palette on the grid with nav-grid regeneration; saved as a per-floor layout override.\n${common("D8")}` },
  { title: "web: performance pass (hidden-tab pause, quality presets, instancing audit, reduced motion)", milestone: "M6 Polish and tycoon layer", areas: ["web"], body: `Pause the render loop when hidden; low/medium/high presets (pixel ratio, shadows, bubble count); instancing for all static props; reduced-motion disables bubbles/confetti; profile 20 robots + 5 humans on an iGPU laptop.\n${common("§11")}` },
];

// ────────────────────────────── runner ──────────────────────────────

async function gh(args: string[], input?: string): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], { stdin: input ? new TextEncoder().encode(input) : undefined, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`gh ${args.join(" ")} failed (${code}): ${err}`);
  return out;
}

async function ensureMilestones(): Promise<Map<string, number>> {
  const existing = JSON.parse(await gh(["api", `repos/${REPO}/milestones?state=all&per_page=100`])) as Array<{ title: string; number: number }>;
  const map = new Map(existing.map((m) => [m.title, m.number]));
  for (const m of MILESTONES) {
    if (map.has(m.title)) continue;
    console.log(`milestone: ${m.title}`);
    if (DRY) continue;
    const created = JSON.parse(await gh(["api", `repos/${REPO}/milestones`, "-f", `title=${m.title}`, "-f", `description=${m.description}`])) as { number: number };
    map.set(m.title, created.number);
  }
  return map;
}

async function ensureLabels(): Promise<void> {
  const existing = JSON.parse(await gh(["label", "list", "-R", REPO, "--json", "name", "-L", "200"])) as Array<{ name: string }>;
  const have = new Set(existing.map((l) => l.name));
  for (const l of LABELS) {
    if (have.has(l.name)) continue;
    console.log(`label: ${l.name}`);
    if (DRY) continue;
    await gh(["label", "create", l.name, "-R", REPO, "-c", l.color, "-d", l.description]);
  }
}

async function ensureIssues(milestones: Map<string, number>): Promise<void> {
  const existing = JSON.parse(await gh(["issue", "list", "-R", REPO, "--state", "all", "--json", "title,number", "-L", "500"])) as Array<{ title: string; number: number }>;
  const have = new Map(existing.map((i) => [i.title, i.number]));
  const epicNumbers = new Map<string, number>();

  // Epics first so tasks can reference them.
  for (const issue of I.filter((i) => i.epic)) {
    const n = await createIfMissing(issue, have, milestones);
    if (n) epicNumbers.set(issue.milestone, n);
  }
  for (const issue of I.filter((i) => !i.epic)) {
    const epic = epicNumbers.get(issue.milestone);
    const body = epic ? `${issue.body}\n\nPart of #${epic}.` : issue.body;
    await createIfMissing({ ...issue, body }, have, milestones);
  }
}

async function createIfMissing(issue: Issue, have: Map<string, number>, milestones: Map<string, number>): Promise<number | undefined> {
  if (have.has(issue.title)) return have.get(issue.title);
  const labels = [issue.epic ? "type:epic" : "type:task", ...issue.areas.map((a) => `area:${a}`)];
  console.log(`issue: ${issue.title}`);
  if (DRY) return undefined;
  const out = await gh([
    "issue", "create", "-R", REPO,
    "--title", issue.title,
    "--body-file", "-",
    "--milestone", issue.milestone,
    "--label", labels.join(","),
  ], issue.body.trim() + "\n");
  const m = out.match(/\/issues\/(\d+)/);
  const n = m ? Number(m[1]) : undefined;
  if (n) have.set(issue.title, n);
  return n;
}

const milestones = await ensureMilestones();
await ensureLabels();
await ensureIssues(milestones);
console.log(DRY ? "dry run complete" : "done");
