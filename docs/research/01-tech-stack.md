# Tech-stack research: self-hosted multiplayer 3D office simulator (Bun + TypeScript)

> Since #226, floors are called operations and robots henchmen; this research predates the rename.

Research date: 2026-09-28. Compiled by a research agent; each item gives recommendation, why, main risk, sources.

## 1. Browser 3D engine

**Recommendation: Three.js + React Three Fiber (R3F) + drei (+ @react-three/rapier only if physics is needed; simple grid/AABB collision is enough for an office).**

- Camera toggle is trivial in R3F: `<OrthographicCamera makeDefault>` for the isometric view, swap to `<PerspectiveCamera makeDefault>` + `<PointerLockControls>` for first-person. Isometric = orthographic camera at ~35.264° pitch / 45° yaw.
- Toon/flat shading: `MeshToonMaterial` with a 3-step gradient map; drei `<Outlines>` for the cel outline.
- GLB + animations: drei `useGLTF` + `useAnimations` (idle/type/walk clips), `<Clone>`/gltfjsx for reusing one robot model across many desks.
- Instancing: drei `<Instances>/<Instance>` for static meshes (desks, chairs, monitors, plants). ~20 animated robots as SkinnedMesh clones is fine; beyond ~50-100 you need vertex-animation-texture tricks.
- HTML in scene (xterm.js on a laptop screen): drei `<Html transform occlude="blending">`. Caveats: breaks with postprocessing passes (no bloom/SSAO on the same canvas), transform mode can look blurry, DOM elements can never be partially occluded. Fallback: CSS3DRenderer.
- Bundle: three ~185 kB vs Babylon ~1.8 MB core. Keep WebGL2 default.
- React UI (kanban, settings, chat) and 3D scene share one component tree and one zustand store.

Alternatives rejected: Babylon.js (viable, heavier, toon look needs custom material); PlayCanvas (editor pipeline is a commercial cloud service); Godot 4 web export (COOP/COEP isolation issues, 10 MB+ wasm, cannot render xterm.js DOM inside the canvas, splits codebase); PixiJS/Phaser (no first-person mode, no true 3D laptop screens).

Main risk: DOM-in-3D is smoke and mirrors. Mitigation: only the focused/near desk gets a live DOM terminal; others show a low-res render-to-texture snapshot (see §7).

Sources: https://drei.docs.pmnd.rs/misc/html , https://github.com/pmndrs/drei/issues/1129 , https://www.webgamedev.com/performance/instanced-meshes , https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html

## 2. Multiplayer networking

**Recommendation: Colyseus (MIT) on Bun via `@colyseus/bun-websockets`, with a fallback plan to a thin custom Bun WebSocket room server.**

- Colyseus on Bun: official transport since 0.15.8; 0.18 docs: `bun add @colyseus/bun-websockets`, `defineServer({ transport: new BunWebSockets({...}) })`. Docs still label Bun support "experimental".
- Gives rooms, presence, schema-based state tree with delta patches (avatar positions, whiteboard stroke list, jukebox `{trackId, startedAtServerTime, paused}`, wall pictures, task queue), reconnection tokens, client that patches a JS object bindable to zustand/R3F.
- Avatar positions: 10-20 Hz from clients, interpolate on client; Colyseus patch rate ~20 Hz.

Alternatives: custom Bun WS rooms (zero-dep, write rooms/diffing yourself; good for the high-rate terminal byte channel); Socket.IO (`@socket.io/bun-engine`, message bus only); PartyKit (Cloudflare only, not self-hostable); WebRTC data channels (reserve for media).

Suggested split: Colyseus room state for low-rate shared state; raw Bun WS per terminal session for PTY bytes; Yjs over its own WS for the whiteboard.

Main risk: experimental Bun transport. Keep networking behind a small interface so it can be swapped.

Sources: https://docs.colyseus.io/server/transport/bun-websockets , https://socket.io/blog/bun-engine/ , https://docs.partykit.io/how-partykit-works/

## 3. Real-time terminals in the browser

**Recommendation: xterm.js (`@xterm/xterm` + fit + webgl addons) in the browser; on the server, Bun's native PTY (`Bun.spawn(cmd, { terminal: {...} })`, since Bun 1.3.5, Dec 2025) spawning `tmux attach -t <session>`; tmux owns the agent process for persistence and multi-attach.**

Architecture:
1. Per agent: `tmux new-session -d -s agent-<id> -x 200 -y 50 'claude ...'`. Agent lives in tmux, so the web server can restart without killing agents; `tmux capture-pane -p -S -2000` gives scrollback to newcomers.
2. Per browser viewer: server spawns `tmux attach -t agent-<id>` in a Bun terminal, pipes PTY bytes to the viewer's WS (binary frames) and keystrokes back. tmux fans out output.
3. Two users on the same terminal: both attach. Watch-only: `tmux attach -r` or drop stdin server-side per role. Sizing: use a fixed virtual size (e.g. 160x45) and let xterm.js scale per viewer, or `window-size latest`.
4. Animation triggers: throttle on PTY output bytes/sec: "typing" when output flows, "idle" otherwise.

Fallback: `bun-pty` (Rust portable-pty over bun:ffi) if Bun PTY edge cases bite. node-pty historically does not work on Bun.

Sources: https://bun.com/blog/bun-v1.3.5 , https://bun.com/docs/runtime/child-process , https://www.npmjs.com/package/bun-pty

## 4. Screen sharing and voice

**Recommendation: self-hosted LiveKit (Apache-2.0) SFU in Docker for both screen share and voice; no mesh.**

- Mesh collapses at 6+ viewers on a laptop uplink. SFU: sharer uploads once.
- LiveKit: single Go binary, official JS SDK (`setScreenShareEnabled`, `setMicrophoneEnabled`), simulcast, embedded TURN, tokens minted from the Bun server via `livekit-server-sdk`. Ports 7880/tcp, 7881/tcp, 50000-60000/udp, 3478/udp TURN.
- Voice: opus tracks in the same room; spatialize by distance to avatar via Web Audio `PannerNode`.
- Make the media stack optional: `docker compose --profile media up`.

Alternatives: mediasoup (library, Node C++ addon, build everything yourself); Janus (heavier ops); mesh only as a 2-4 user no-Docker MVP.

Main risk: ops burden (UDP ranges, TLS, TURN). 20-40% of connections need TURN.

Sources: https://docs.livekit.io/deploy/custom/deployments/ , https://trembit.com/blog/livekit-vs-mediasoup/

## 5. Shared jukebox

**Recommendation: server-authoritative playhead + NTP-style client clock sync. Sources: (a) self-hosted audio files via Web Audio (tight sync), (b) YouTube IFrame Player API (rough sync). No Spotify.**

- State: `{ trackId, startedAtServerMs, pausedAtMs|null, volume, queue[] }`.
- Clock sync: periodic 4-timestamp ping, keep lowest-RTT samples. Schedule play/seek at "server time T". Drift: |drift| < ~75 ms → nudge `playbackRate` ±0.3-0.5%; larger → hard re-seek.
- Browsers require a user gesture before audio: gate on "enter office" click.
- YouTube: official unmodified embed only, comply with API ToS; iframe cannot be occluded, so show as HUD panel.
- Spotify: Premium per listener, forbids shared simultaneous playback. Not feasible.
- Legal: ship only CC0/CC-BY tracks with attribution; user uploads are the operator's responsibility.

Sources: https://developers.google.com/youtube/iframe_api_reference , https://developer.spotify.com/terms , https://github.com/cypher-30/chorus

## 6. Shared whiteboard

**Recommendation: Excalidraw (`@excalidraw/excalidraw`, MIT) with Yjs sync (`y-excalidraw` or an element-level reconciler) over a y-websocket endpoint in the Bun server, persisted as Yjs update blobs in SQLite.**

- tldraw rejected: since Sept 2025 the SDK is source-available; production use needs a license key; hobby license is non-commercial and requires a watermark. Incompatible with permissive self-hosted OSS.
- Excalidraw npm package excludes collaboration; wire `onChange` + `updateScene` yourself. Options: `y-excalidraw`, `excalidraw-yjs` (Alkemio, MIT, early), or the official `excalidraw-room` socket.io server.
- Lazy-load Excalidraw (~1 MB).

Main risk: element-level merges → last-writer-wins on the same element; acceptable.

Sources: https://tldraw.dev/community/license , https://github.com/RahulBadenkal/y-excalidraw , https://github.com/alkem-io/excalidraw-yjs

## 7. Rendering boards, wall art, trackers inside the 3D scene

**Recommendation: two tiers. "Posters" are textures; "interactives" are DOM overlays that appear only on focus.**

- Wall art: `MeshBasicMaterial` + `TextureLoader` image; `<Instances>` for frames.
- Kanban / usage tracker / whiteboard when not focused: snapshot to a `CanvasTexture`. Whiteboard via Excalidraw `exportToCanvas` (throttled ~2 s). Charts: draw directly with Canvas 2D (prefer over `html-to-image`).
- On focus: swap to drei `<Html transform occlude="blending">` with the live component, or open a 2D modal (better UX for whiteboard editing). At most 1-2 live DOM panels at a time.
- Terminals: focused desk → live xterm.js; far desks → `CanvasTexture` from tmux `capture-pane` text.
- WebGL render-to-texture cannot rasterize DOM; `html-to-image` cannot capture cross-origin iframes (YouTube stays HUD).

## 8. Auth and per-user secrets

**Recommendation: Better Auth (MIT) on Bun with `bun:sqlite`; email+password local accounts and GitHub social login by default; Generic OAuth plugin for OIDC as an operator option. Encrypt per-user provider API keys with AES-256-GCM under a server master key (envelope encryption).**

- Better Auth documents `bun:sqlite`; GitHub social provider; Generic OAuth for OIDC; sessions, org/roles plugins. Use `bunx --bun @better-auth/cli generate`. Support first-user-becomes-admin and invite links.
- Secrets: symmetric AEAD, not sealed boxes (server must decrypt to inject into agent processes). `MASTER_KEY` from env/0600 file/systemd credential. Per secret: random DEK, AES-256-GCM (12-byte nonce, AAD = `userId|secretName`), DEK wrapped by master key; store `{ciphertext, nonce, wrappedDEK, keyVersion}`. Rotation = re-wrap DEKs.
- Never log decrypted values; inject at spawn time only. Agents can `printenv`: any user with terminal control can read the injected key. Scope agents per user/project with explicit key selection.

Sources: https://better-auth.com/docs/adapters/sqlite , https://better-auth.com/docs/plugins/generic-oauth , https://libsodium.gitbook.io/doc/secret-key_cryptography/aead/aes-256-gcm

## 9. Persistence

**Recommendation: SQLite via `bun:sqlite` in WAL mode through Drizzle ORM; Postgres later via Drizzle's `bun-sql` driver if ever needed.**

Rules: single Bun process owns the DB; `PRAGMA journal_mode=WAL; busy_timeout=5000; synchronous=NORMAL`; large blobs on disk, not in SQLite. Backups via `sqlite3 .backup` or Litestream.

## 10. Packaging and agent execution environment

**Recommendation: Docker Compose as primary distribution (`office` Bun image + optional `livekit` + optional `postgres` + `caddy`), agents executed in one long-lived "runner" container per project (not one container per agent). Keep `bun run` working for dev. Skip Packer/cloud-init images.**

- Agent execution options: (1) plain workdirs on host: zero isolation, OK for a trusted solo user; (2) runner container per project with toolchain, `docker exec`'d tmux sessions, cgroup limits, workdir bind-mounted: recommended default; (3) agents needing Docker: never mount `/var/run/docker.sock` into agent containers; use sysbox/rootless DinD/Docker Sandboxes as opt-in; (4) build runner image from the target repo's `devcontainer.json` via `@devcontainers/cli`.
- Sandboxing primitives: bubblewrap (<50 ms spawn, what Claude Code uses), Landlock, seccomp, containers, microVMs.
- `office` container gets the Docker socket (or a docker-socket-proxy); runners never do.

Sources: https://markphelps.me/posts/running-ai-agents-in-devcontainers/ , https://github.com/ssmirr/awesome-AI-sandbox

## 11. GitHub integration

**Recommendation: GitHub App for repo data + webhooks with installation tokens; GitHub OAuth (via Better Auth) only for login/identity. PAT fallback for solo self-hosters.**

- `octokit` works on Bun. Webhook endpoint `/api/github/webhook` via reverse proxy; polling mode (ETag-conditional `GET /issues?since=` every 30-60 s) when no inbound URL; optional smee-style relay or Cloudflare Tunnel.
- Cache issues/PRs in SQLite, push changes into Colyseus state so the kanban wall updates live. Agents comment/open PRs via the installation token scoped to their project.
- Agents' git pushes: per-project deploy key or App installation token via `git credential` helper; never hand users' PATs to agents.
- GitHub App Manifest flow lets the setup page create the App in one click.

## 12. Process discovery

**Recommendation: every agent session in its own cgroup (`systemd-run --scope --unit=agent-<id>` on host, or the runner container's cgroup); discover listening ports by scanning `/proc/net/tcp{,6}` (state `0A`), map socket inodes to PIDs via `/proc/<pid>/fd`, filter PIDs by cgroup.**

- `cgroup.procs` lists every PID the agent spawned even if daemonized; kill the whole scope on stop.
- Fast path: PTY output containing `localhost:`/`http://` URLs, confirmed via port scan. Poll every 2-3 s while active.
- "Open in browser": reverse proxy maps `https://office.example/p/<project>/port/<n>/` to the port with an auth check; WebSocket upgrades rewritten (Vite HMR needs `base`); alternative per-port subdomain mode.
- Inside runner containers, scan in the container's net namespace (`nsenter -t <pid> -n`).

Sources: https://github.com/wrinfotel/portsight , https://linux-audit.com/processes/faq/how-to-see-cgroup-of-a-process/

## One-page stack summary

- Client: Vite + React + Three.js/R3F/drei, zustand, xterm.js, Excalidraw, livekit-client.
- Server (Bun, one process): Bun.serve HTTP + Colyseus (`@colyseus/bun-websockets`) + raw WS for PTY streams + y-websocket for whiteboard; Bun native PTY → tmux; Better Auth; Drizzle + bun:sqlite (WAL); octokit.
- Infra: Docker Compose (`office`, `runner` image, `caddy`; profiles `media` = LiveKit, `pg` = Postgres). Agents in per-project runner containers with tmux, cgroup-tracked.
- Licenses: all MIT/Apache except tldraw (excluded) and Spotify (excluded); YouTube via official embed only; CC0/CC-BY music only.
