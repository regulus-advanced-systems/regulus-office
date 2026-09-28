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

## Inspiration and credits

- [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) (MIT) for many of the office ideas.
- Game Dev Tycoon by Greenheart Games for the look. No assets from the game are used.
- Character and furniture assets from Quaternius, Kenney and KayKit (CC0); attribution for CC-BY assets will live in `packages/assets/ATTRIBUTION.md`.

## License

MIT. See [LICENSE](LICENSE).
