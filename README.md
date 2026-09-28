# Regulus Office

A self-hosted, multiplayer office simulator where the employees are real AI coding agents.

Walk around an isometric office drawn in the spirit of Game Dev Tycoon. Each floor is a project. Sit a cute robot down at a free desk, pick a provider (Claude Code, Codex, Gemini CLI, OpenCode, Kimi Code, or DeepSeek / Z.AI / Kimi through them), give it an issue, and watch it type. Open its terminal any time. Teammates log in, bring their own provider logins, share a whiteboard, a jukebox and their screens, and a project-manager robot walks the floor and hands you a daily brief.

Status: **specification phase**. Nothing runs yet. Read [`docs/SPEC.md`](docs/SPEC.md) for the full design and [`docs/research/`](docs/research/) for the research behind it.

## Principles

- Real agents, real terminals. Nothing is faked.
- Structured by default, terminal on demand.
- Per-user credentials, always. The office never stores or shares subscription tokens.
- Floor = project.
- Look like Game Dev Tycoon, run on a laptop.
- Self-hostable by one person with Docker Compose.

## Planned stack

Bun + TypeScript. React + Three.js (React Three Fiber) client. Colyseus rooms for multiplayer. Bun native PTY + tmux for terminals. Excalidraw + Yjs whiteboard. LiveKit for screen share and voice (optional). Better Auth. SQLite via Drizzle. GitHub App integration. Hermes Agent as the project-manager robot.

## Recommended machine

The office server itself is light (one Bun process, SQLite, Caddy). Rendering happens in each visitor's browser, so the server needs no GPU. What sizes the machine is the number of AI agents running at the same time: each agent is a real CLI process (Node) plus whatever the project's builds and tests consume in that agent's worktree.

Rule of thumb: reserve about 1 GB RAM and half a vCPU per concurrently active agent, on top of a 2 GB / 1 vCPU base, plus the memory your projects' test suites and dev servers need.

| Tier | Use | vCPU | RAM | Disk | Example |
|---|---|---|---|---|---|
| Minimum | Solo, 1-3 agents, no media | 2 | 4 GB | 40 GB SSD | Hetzner CX22 / CPX11 |
| Recommended | Team of 2-5 humans, up to ~10 agents | 4 | 16 GB | 100 GB NVMe | Hetzner CX32 / CPX31 |
| Large | Up to ~20 agents, screen share and voice on | 8 | 32 GB | 200 GB NVMe | Hetzner CPX41 / CCX23 |

Other requirements:

- **OS:** Ubuntu 24.04 LTS or any recent Linux with systemd and Docker 27+. x86-64 or arm64.
- **Disk:** NVMe/SSD. Budget disk for every project checkout plus one git worktree per active agent, container images (~3 GB for the runner image), and terminal scrollback.
- **Network:** a public IPv4 or IPv6 address and a domain name for automatic TLS. Inbound TCP 80 and 443. With the optional media profile (LiveKit) also TCP 7881, UDP 3478 and UDP 50000-60000. Outbound HTTPS to GitHub and the AI provider APIs. Behind NAT or on a LAN, run it on a Tailscale/private network and use GitHub polling instead of webhooks.
- **Swap:** enable 2-4 GB of swap; agent memory use is spiky.
- **Backups:** the SQLite database and the data directory are small; snapshot them nightly. Project repos live on GitHub anyway.

Visitors need a modern browser with WebGL2 (Chrome, Firefox, Safari, Edge) on a laptop with an integrated GPU or better; 1080p is the design target.

## Inspiration and credits

- [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) (MIT) for many of the office ideas.
- Game Dev Tycoon by Greenheart Games for the look. No assets from the game are used.
- Character and furniture assets from Quaternius, Kenney and KayKit (CC0); attribution for CC-BY assets will live in `packages/assets/ATTRIBUTION.md`.

## License

MIT. See [LICENSE](LICENSE).
