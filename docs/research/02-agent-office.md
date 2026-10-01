# Research: AgentSystemLabs/agent-office

> Since #226, our floors are called operations and robots henchmen. The Floor and robot names below are the researched project's own.

Research date: 2026-09-28, HEAD `a8fa16f` (v0.1.116). Inspiration repo; MIT licensed (attribution required if code is copied).

## License, activity
- MIT. 198 stars, 46 forks. Created 2026-09-26; 100+ commits in 2 days, essentially single-author (`webdevcody`). Release per commit on main. README (435 lines) is the only documentation.

## Tech stack
| Concern | Choice |
|---|---|
| Language | TypeScript (ESM), Node >= 20 |
| 3D | Three.js r186, `MeshToonMaterial` + `OutlineEffect`, everything built from primitives (no GLB assets at all) |
| Frontend | Vanilla TS DOM; React only for the lazy-loaded Excalidraw whiteboard |
| Backend | Node `http` + `ws`; no Express |
| Database | None. JSON files under `~/agent-office/.agent-office/` and per-project `.agent-office/` |
| Realtime | One WebSocket at `/ws` with a JSON discriminated union (`src/shared/protocol.ts`, 1152 lines). WebRTC mesh for voice/screen share, signaling over the same WS |
| Terminals | `@lydell/node-pty` in a detached PTY host process (Unix socket + token), mirrored into `@xterm/headless` for late-join snapshots; `@xterm/xterm` in a modal; 3D laptop screens get row-diff "runs" rendered to `CanvasTexture`. No tmux |
| Agent spawn | `WorkerManager` spawns CLI in PTY; status via each CLI's hooks/plugins posting to a loopback "hook server" |
| Build | Vite 8 (client), tsc (server), `node --test` (25 test files) |

## Architecture
- Server authoritative for all shared state; client authoritative only for its own avatar position (server relays `move`).
- `Floor` = per-project bundle: WorkerManager, GitHub + MergeWatch, TaskQueue, Changes, Decor, Dog, Jukebox, Whiteboard, MeetingRoom, Worktrees. `Building` owns `floors.json`, palettes (10, `MAX_FLOORS = 16`), repo cloning.
- Floor = broadcast scope. Chat, voice signaling, budget, sky are building-wide.
- Movement: client sends `move` at most every 66 ms; no server tick, no interpolation authority.
- Sync patterns worth copying: full-entity `worker.update`; row-diff terminal screens; deterministic-by-clock sync for dog routes and music (server sends "what and when started", clients simulate; ping/pong clock offset).
- Loopback hook server: `POST /hooks/claude|opencode|codex?worker=&event=` with per-worker bearer token; `/office/queue` for board agents; optional relay for worker dev servers.

## Complete feature list (for check-off)

World / navigation / avatar
1. Walk/run/jump; first-person (default, pointer lock, rendered hands) and third-person orbit
2. Realtime multiplayer presence with name tags and "doing" lines
3. Character select (skin, hair, shirt), changeable later
4. Emotes (wave, thumbs up, clap, dance, point, facepalm) via radial wheel
5. Sitting on couches, beanbags, benches; seat state synced
6. Coffee machine buff (faster walk for a minute; jitters after 3 cups)
7. Smoke break on balcony
8. Boss office loft with stairs, glass walls
9. Ladders, trapdoors, fire poles between floors
10. Multi-storey tower exterior that grows with floors; balconies
11. Garage with cars, street outside
12. Elevator with floor picker; shows busy/waiting counts per floor
13. Floor-per-project: pick a GitHub repo, cloned; own palette, workers, boards, queue, decor, dog, jukebox, whiteboard, meetings
14. Day/night cycle + weather (live forecast via open-meteo with `--city`)
15. Holiday themes (Halloween, Christmas) auto by calendar
16. Office dog per floor (A* nav, naps by busy workers, barks at waiting workers, pettable, nameable)
17. Rooftop bar (DJ stage, synth drum & bass, lights, drinks with "drunk" shader)
18. Jukebox (synth lo-fi tunes, internet radio URL, positional, clock-synced)
19. Synthesized office ambience (keyboard clatter, footsteps, rain, coffee grinder, gong, barks)
20. Arcade cabinet (Tetris-like), spectators see the screen, high scores
21. Minesweeper on the boss's monitor
22. Confetti + merge gong on PR merge; workers dance; triple ring when queue empties
23. Wall pictures: paste image URL, hang on walls, resize, move, remove; server proxies images; persisted
24. Machine monitor on wall (CPU/mem, worker count, pressure warnings)
25. Compass / edge pins pointing to off-screen waiting workers (red = needs input, green = done)
26. Graphics quality setting (open PR #82)

Agents / terminals
27. Hire a worker at a desk: Claude Code / OpenCode / Codex / Custom; initial prompt; model + effort pickers
28. 16 desks + 12 overflow beanbags
29. Shared plain shells at empty desks
30. Shared live terminals: multi-user typing with "X is typing", viewer faces, late-join scrollback
31. Laptop screens in 3D showing the live terminal (row-diff frames)
32. Worker status indicators (starting/idle/working/needs_input/done/exited/offline) via antenna bulb colour; jump + ding when needing input
33. Workers act out tool calls (reading = flipping papers, editing = frantic typing, tests = leaning back, web = spinning globe, failing = head in hands, done = spin + confetti)
34. Task cards over heads (one-line summary written by Haiku)
35. "Next waiting worker" hotkey cycling oldest-first
36. Workers panel (list, model, cost)
37. Resume sleeping worker via provider session IDs
38. Send home with animated box-carrying exit + worktree cleanup dialog
39. Prompt an existing worker, including "Ask a worker" on any issue/PR
40. Isolated git worktrees per worker, cleanup, prune
41. One-click PR from a worktree worker (push + `gh pr create`, `Closes #n`)
42. Changes window: live git status/diff, per-file diff, commit, discard, push + PR
43. Survives restarts: workers persisted with session id; PTYs in detached host; scrollback persisted
44. Search across chat + all terminals
45. Cost tracking per worker (Claude: transcript JSONL priced from a table; OpenCode: plugin-reported; Codex: rollout JSONL); today/all-time; `--budget` warnings and `--budget-pause`
46. Claude plan limits meter (5-h, weekly, per-model) via stream-json `get_usage` control request, polled every 2 min
47. Worker capacity limit with memory/CPU pressure warnings; queue waits for room
48. Desktop notifications + tab-title badge for waiting workers
49. Slack/Discord webhook notifications
50. Services board: auto-detects web servers workers start (port scan every 4 s), relay through office port, "open in browser"

GitHub / project management
51. Issues board (cork board: Open / In progress / Closed; read, comment, hand to worker, add to queue, close)
52. Physical issue cards: pluck off the board, carry, drop on a desk/worker/queue; auto-assign on GitHub
53. PR board (Draft / In review / Approved / Merged / Closed, CI status, diff viewer with review comments, merge/close, "Fix comments & merge", "Fix conflicts & merge" hand-offs)
54. Task queue: free-text or issue tasks with provider/model/effort, concurrency limit, reorder, retry, auto-worktree, links PR when it appears
55. Board agents (kiosk agents for Issues, PRs, Queue with briefs; restricted tools; `office-queue` CLI)
56. Meeting room: 2-5 workers collaborate in patterns (Debate, Lead & team, Map-reduce, Red/blue, Review panel); shared worktree; round + token budgets; output committed or posted as PR review
57. Repo picker / add floor via `gh repo clone`

Collaboration
58. Text chat (persisted 1,000 lines)
59. Voice chat (WebRTC mesh, proximity volume, mouth animation)
60. Screen sharing to the lounge TV + fullscreen viewer
61. Collaborative whiteboard (Excalidraw, live cursors, rendered onto the 3D board, per-floor)
62. Whereabouts / click-to-walk-to-teammate (rides elevator)
63. HUD/menu customization
64. Settings panel

Accounts / ops
65. Accounts & invites (shared password → per-person accounts via invite links, admin/member roles)
66. Claim link for first password
67. Team SSH invites for AWS deploys
68. Self-upgrade from the UI
69. HTTPS options
70. AWS one-command deploy script

## Provider integration
- Supported: Claude Code, OpenCode, Codex CLI, Custom executable. No Gemini CLI, no ACP, no SDKs, no MCP. Pure PTY wrapper + CLI-native hooks.
- Claude: `claude --settings <hooks.json> [--model] [--effort] [--resume] -- <prompt>`; hooks curl the loopback hook server with per-worker bearer token; hook payloads carry `transcript_path` which is tailed for token usage. OSC 9;4 progress sequences parsed as busy/idle. Task names via `claude -p --model haiku`. Plan limits via stream-json `get_usage`.
- OpenCode: plugin injected through `OPENCODE_CONFIG_CONTENT`.
- Codex: hooks via per-process config overrides; requires the user's `/hooks` trust approval. Usage from rollout JSONL (verified against Codex 0.154.0).
- Env scrubbing: `childEnv()` removes `CLAUDECODE`, `CLAUDE_CODE_*`, `CODEX_THREAD_ID`, etc.
- Credentials: whatever the OS user running the server has. No per-user credential model. Any office member can run commands as that user.

## Multiplayer & auth
- Shared office password (scrypt) or per-person accounts via single-use invite links; HMAC-signed cookies; admin/member roles; rate limiting. WS checks cookie + Origin.
- No per-user credentials (issue #6 asks for viewer roles, #7 audit log).

## Deployment
- No Dockerfile/compose. Install script → `~/.local/share/agent-office`; VPS via SSH tunnel or Caddy/nginx; AWS one-command script (t3.xlarge, loopback only, SSH-forward-only `office` user).

## Art style
- Flat-shaded toon low-poly from Three.js primitives, 3-step gradient ramp + ink outline. Round-headed stylised people with an antenna status bulb. First-person default. Zero binary assets; all textures are runtime canvases; all audio synthesized with Web Audio.
- Layout in meters: floor 36 x 26 m, 16 desks in two 2-row pods, loft, meeting room, lounge, kitchen, balcony, elevator on north wall.

## Weaknesses relevant to us
1. Performance: always-on 60 FPS with shadows + outline at 2x DPR (issue #16 wants a 2D fallback). A fixed tycoon camera lets us cull/bake far more.
2. Monolithic files (main.ts 2953 lines, server.ts 1779, workers.ts 1639).
3. No DB, no migrations, wholesale JSON rewrites; O(clients) JSON stringify per broadcast.
4. Client-authoritative movement, spoofable; fine for trusted teams only.
5. Shared credentials: one OS user for everyone. Per-user credentials would be a real differentiator.
6. Provider integration fragile by construction (hook systems, OSC heuristics, JSONL scraping that is version-dependent). No ACP path.
7. Worktrees cut from stale local HEAD (issue #119): must `git fetch` and base on `origin/<default>`.
8. Floors are one fixed template with palette swap; no data-driven layout.
9. Nav obstacles hand-listed for A*.
10. Extreme churn; thin CI.
11. Partial Windows support.
12. Trusted-team security posture (`/api/image` is SSRF-by-design; board agents get `gh` write).
13. Requested features: achievements/trophy shelf (#42), receptionist/onboarding (#41), manager NPC running the queue (#29), planning table (#30), context-window fill indicator (#33), quick reply from speech bubble (#26), command palette (#37), private voice rooms (#38).
14. Not a game: no progression, economy, hiring costs, upgrades, scoring.

## Reusable pieces (MIT, attribution required)
- `src/shared/protocol.ts`: complete wire schema (WorkerInfo/Status/Action, PeerInfo, QueueTask, Meeting*, Gh*, Usage, FloorView, ClientMsg/ServerMsg unions).
- PTY host architecture (`ptys.ts`, `ptyhost.ts`, `screen.ts`) and the terminal "screen runs" diff format for in-world displays.
- Provider adapters: Claude hook settings generator + handler, OpenCode plugin + config merge, Codex hook normaliser + rollout reader, Claude transcript pricing table, plan-limits reader (`limits.ts`), Haiku task-namer.
- GitHub layer (`gh` wrapper, merge-watch), worktrees + prune, changes watcher.
- Task queue + `office-queue` CLI, meeting patterns.
- Auth/accounts (signed cookies, scrypt, invite links, rate limiting).
- Services discovery + relay.
- Procedural toon art kit (`toon.ts`, `character.ts`, `confetti.ts`, `sky.ts`), synthesized SFX/music.
- Deterministic-by-clock sync pattern for ambient NPCs and music.
