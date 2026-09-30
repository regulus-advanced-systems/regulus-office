# Regulus Office

A self-hosted, multiplayer office simulator where the employees are real AI coding agents.

Walk around an isometric office drawn in the spirit of Game Dev Tycoon. Each floor is a project. Sit a cute robot down at a free desk, pick a provider (Claude Code, Codex, Gemini CLI, OpenCode, Kimi Code, or DeepSeek / Z.AI / Kimi through them), give it an issue, and watch it type. Open its terminal any time. Teammates log in, bring their own provider logins, share a whiteboard, a jukebox and their screens, and a project-manager robot walks the floor and hands you a daily brief.

Status: **M0 Foundations**. Humans can sign in, walk around the lobby together, chat and switch to first person; no agents yet. Read [`docs/SPEC.md`](docs/SPEC.md) for the full design and [`docs/research/`](docs/research/) for the research behind it.

## Quickstart (Docker Compose)

Needs Docker with Compose v2 and free ports 80 and 443.

```sh
git clone https://github.com/regulus-advanced-systems/regulus-office.git
cd regulus-office/deploy
cp .env.example .env
# Fill in the two required secrets (Compose refuses to start without them):
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|^OFFICE_MASTER_KEY=.*|OFFICE_MASTER_KEY=$(openssl rand -base64 32)|" .env
docker compose up -d --build
curl -k https://localhost/healthz
```

Open <https://localhost>. Caddy serves `localhost` with its own internal CA, so the browser asks you to accept the certificate once (or run `docker compose exec caddy caddy trust`). The first account you register becomes the **owner**; invite everyone else from Settings → *Invite someone…*.

To script the setup instead, create the owner and a first invite link from the repo root:

```sh
bun install
bun run seed --url https://localhost --email you@example.com --name "Your Name"
```

It prints a generated password once (pass `--password` to choose one) and the invite URL. Run again with `--password` to mint more invites (`--role admin|member|viewer`); it never creates a second owner.

For a real server set `OFFICE_DOMAIN` in `deploy/.env` to a hostname pointing at the machine; Caddy then gets a Let's Encrypt certificate and the office is served at `https://<domain>`. Tagged releases publish images to `ghcr.io/regulus-advanced-systems/regulus-office` and `…/regulus-office-runner`; `docker compose pull && docker compose up -d` without `--build` uses them.

**Docker access.** Agents run in one runner container per human, which the office creates through the Docker Engine API. Only the `docker-proxy` service mounts `/var/run/docker.sock`; it forwards an allowlist of container, exec, image, volume and network-read calls to the office alone and answers 403 to everything else (build, swarm, secrets, system info, network changes, bind mounts outside `/srv/office`). The office runs as a non-root user without the socket, and runners never get the socket (SPEC §8). The allowlist and the reason for each entry are in `deploy/docker-compose.yml`; `docker compose exec -T office bun run - < docker-proxy-check.ts` checks it. The proxy narrows what a compromised office process could do but is not a sandbox: the office can still create containers. For rootless Docker set `DOCKER_SOCKET` in `deploy/.env`.

**Runners.** Build the runner image once (it is large: Node, Bun, Python, uv, gh and the pinned agent CLIs) with `docker compose --profile build-only build runner-image`, or let the office pull the release tag on first use. Each human gets one runner container, `<project>-runner-<user>`, running as uid 1001 with a `<project>-home-<user>` volume as HOME for their CLI logins. Runners share only two things with the office:

- the `projects` and `worktrees` volumes (`/srv/office/{projects,worktrees}`); a runner mounts just the floor directories it needs, at the same paths. The office user is in group 1001, the roots are setgid, and the office runs with umask 0002, so floor checkouts are group-writable for runners. Git repos the office creates for floors should use `core.sharedRepository=group` so objects a runner commits stay writable for both sides.
- the `runners` network, where they reach the office at `OFFICE_RUNNER_OFFICE_URL` (default `http://office:4600`) for agent hooks and the statusline. docker-proxy and Caddy are not on it.

Claude Code robots report to the office through `type: "command"` hooks and a statusline command: small scripts in `~/.regulus-office/claude/<robot>/` that POST to `OFFICE_RUNNER_OFFICE_URL` with the robot's token read from a 0600 file. Claude Code's `type: "http"` hooks are not used because Claude Code refuses them for any host that resolves to a private address, such as `office` on the `runners` network.

**Updating the agent CLIs.** The CLIs are pinned in `runner/Dockerfile` and do not update themselves inside runners (`DISABLE_AUTOUPDATER`/`DISABLE_UPDATES` for Claude Code, `check_for_update_on_startup = false` in `/etc/codex/config.toml` for Codex): they are root-owned and runners are not root. To update them, bump the version build args, and rebuild the runner image (`docker compose --profile build-only build runner-image`). The office moves each human's runner to the new image on its next use while it is idle; logins in the HOME volumes are kept.

After a Claude sign-in and before each Claude Code robot starts, the office sets `hasCompletedOnboarding` in the runner's `~/.claude.json` (the CLI's own first-run flag; `claude auth login` does not set it) and, with `OFFICE_CLAUDE_TRUST_WORKTREES` (default `true`), `projects["<worktree>"].hasTrustDialogAccepted` for that robot's own office-created worktree only. It runs a small script in the runner as the runner user, keeps every other key and never opens `~/.claude/`. A robot that still shows Claude's sign-in or trust screen waits for its human, who finishes it in the robot's terminal.

`docker compose exec -T office bun run - < runner-e2e.ts` runs the fake agent in a throwaway runner end to end. Runner containers and HOME volumes are created by the office, so `docker compose down -v` does not remove them; remove them first (this also frees the `runners` network): `docker rm -f $(docker ps -aq --filter label=org.regulus.office.prefix=<project>)`, then `docker volume rm $(docker volume ls -q --filter label=org.regulus.office.prefix=<project>)` if you also want to delete the logins. `<project>` is the Compose project name (`deploy` unless you pass `-p`).

### Connect GitHub

Floors are GitHub repos. Connect the office to GitHub once, as an owner or admin, and **Add floor** lists every repo the connection can see (search, tick one or more). Clones, fetches, pushes and one-click PRs then use the connection's token; typed repos under *Other repo…* keep their own optional token. Credentials are stored encrypted (so `OFFICE_MASTER_KEY` must be set), are never sent to browsers, logged or given to agents.

**GitHub App (recommended).** Settings → *GitHub* → type the organization (empty = your personal account) → *Create GitHub App…*. GitHub opens with a private app for this office already filled in; create it, then install it on the organization for all or selected repos. The office asks for Contents, Pull requests and Issues (read and write), Checks and Metadata (read). The app's private key and webhook secret are converted and stored by the office; nothing goes into `.env`. The office mints a one-hour installation token narrowed to one repo for each git or API call, and caches it until five minutes before it expires. To add repos later, change the installation's repository access on GitHub. Webhooks stay off until the boards (M2) need them.

**Organization token (fallback).** On GitHub: Settings → Developer settings → Fine-grained tokens → *Generate new token*, resource owner = the organization, all or selected repositories, permissions *Contents: read and write*, *Pull requests: read and write*, *Metadata: read*. In the office: Settings → *GitHub* → paste it under *Or an organization access token* → *Connect with token*.

**From the environment.** `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` (optionally `GITHUB_APP_CLIENT_ID`, `GITHUB_WEBHOOK_SECRET`) configure the App instead and override whatever was connected in the UI. `OFFICE_GITHUB_API_BASE` and `OFFICE_GITHUB_WEB_BASE` point at another GitHub (tests use a fake).

Developing instead? See [CONTRIBUTING.md](CONTRIBUTING.md): `bun install && bun run dev`. The browser smoke test runs with `bun run e2e` (needs `bunx playwright install chromium` once).

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
