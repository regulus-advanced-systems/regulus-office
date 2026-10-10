# Regulus Office

A self-hosted, multiplayer office simulator where the employees are real AI coding agents.

Walk around an isometric office drawn in the spirit of Game Dev Tycoon. Each project is an operation with its own room in the compound. Sit a henchman down at a free desk, pick a provider (Claude Code, Codex, Gemini CLI, OpenCode, Kimi Code, or DeepSeek / Z.AI / Kimi through them), give it an issue, and watch it type. Open its terminal any time. Teammates log in, bring their own provider logins, share a whiteboard, a jukebox and their screens, and a project-manager agent walks the compound and hands you a daily brief.

Status: **M0 Foundations**. Humans can sign in, walk around the lobby together, chat and switch to first person; no agents yet. Read [`docs/SPEC.md`](docs/SPEC.md) for the full design and [`docs/research/`](docs/research/) for the research behind it.

## Install on your server

For an existing Linux VM (reference: Ubuntu 24.04, see [Recommended machine](#recommended-machine)) with a DNS record pointing at it. Nothing is provisioned for you: clone the repo on the VM and run the setup script.

```sh
git clone https://github.com/regulus-advanced-systems/regulus-office.git
cd regulus-office
scripts/setup.sh --domain office.example.com
```

The script is safe to re-run. It:

1. checks the machine: Docker 27+ with Compose and Buildx, free ports 80/443, RAM, disk, swap and whether the domain resolves here, and prints the exact fix command for anything missing (`--install-docker` installs Docker from Docker's apt repository on Ubuntu, after asking);
2. creates `deploy/.env` (mode 600) if absent, generates `BETTER_AUTH_SECRET` and `OFFICE_MASTER_KEY`, never overwrites existing secrets, and refuses to start with one that looks truncated (each must be 44 base64 characters, 32 bytes);
3. creates the backup directory, `deploy/backups/` (gitignored) unless you pass `--backup-dir /some/path`, with mode 700 for uid 1000, the office user; existing backups in it are never touched. The `backup` service writes a nightly copy of the database there, outside the data volume (see [Backups and restore](#backups-and-restore));
4. builds the office image from the checkout (or pulls the release images when the checkout is on a release tag; `--images build|pull` to choose), and builds the runner image, which takes about 7 minutes and 3 GB the first time and is skipped afterwards while `runner/` is unchanged. If Docker's build cache is corrupted (`parent snapshot … does not exist`), it explains the error and offers `docker builder prune`;
5. runs `docker compose up -d --wait` and checks `/healthz` through Caddy;
6. optionally creates the owner account and an invite (`--owner-email you@example.com`, needs `bun` on the host); otherwise the first account registered at `/login` becomes the owner;
7. prints next steps: connecting the GitHub App (below), notification webhooks, where backups go and how to restore them.

If ports 80/443 are taken, it asks for other ports (or pass `--http-port 8080 --https-port 8443`), stores them as `OFFICE_HTTP_PORT`/`OFFICE_HTTPS_PORT` and sets `OFFICE_PUBLIC_URL` to match. Let's Encrypt still needs 80/443 to reach Caddy, so on a public domain forward them. `--non-interactive` never prompts (for automation; CI runs it this way). `--domain localhost` serves `https://localhost` with Caddy's internal CA.

Upgrade with `scripts/setup.sh --upgrade`: it fast-forwards a clean checkout, rebuilds what changed and restarts the office; henchmen keep running in their runner containers. `scripts/setup.sh --help` lists every option. The plain Compose steps below keep working if you prefer them.

## Quickstart (Docker Compose)

Needs Docker with Compose v2 and free ports 80 and 443.

```sh
git clone https://github.com/regulus-advanced-systems/regulus-office.git
cd regulus-office/deploy
cp .env.example .env
# Fill in the two required secrets (Compose refuses to start without them):
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|^OFFICE_MASTER_KEY=.*|OFFICE_MASTER_KEY=$(openssl rand -base64 32)|" .env
# Nightly backups go here, outside the data volume; the backup service runs as uid 1000:
sudo install -d -m 700 -o 1000 -g 1000 backups
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

For a real server set `OFFICE_DOMAIN` in `deploy/.env` to a hostname pointing at the machine (or use [`scripts/setup.sh`](#install-on-your-server)); Caddy then gets a Let's Encrypt certificate and the office is served at `https://<domain>`. Tagged releases publish images to `ghcr.io/regulus-advanced-systems/regulus-office` and `…/regulus-office-runner`; `docker compose pull && docker compose up -d` without `--build` uses them.

**Docker access.** Agents run in one runner container per human, which the office creates through the Docker Engine API. Only the `docker-proxy` service mounts `/var/run/docker.sock`; it forwards an allowlist of container, exec, image, volume and network-read calls to the office alone and answers 403 to everything else (build, swarm, secrets, system info, network changes, bind mounts outside `/srv/office`). The office runs as a non-root user without the socket, and runners never get the socket (SPEC §8). The allowlist and the reason for each entry are in `deploy/docker-compose.yml`; `docker compose exec -T office bun run - < docker-proxy-check.ts` checks it. The proxy narrows what a compromised office process could do but is not a sandbox: the office can still create containers. For rootless Docker set `DOCKER_SOCKET` in `deploy/.env`.

**Runners.** Build the runner image once (it is large: Node, Bun, Python, uv, gh and the pinned agent CLIs) with `docker compose --profile build-only build runner-image`, or let the office pull the release tag on first use. Each human gets one runner container, `<project>-runner-<user>`, running as uid 1001 with a `<project>-home-<user>` volume as HOME for their CLI logins. Runners share only two things with the office:

- the `projects` and `worktrees` volumes (`/srv/office/{projects,worktrees}`); a runner mounts just the operation directories it needs, at the same paths. The office user is in group 1001, the roots are setgid, and the office runs with umask 0002, so operation checkouts are group-writable for runners. Git repos the office creates for operations should use `core.sharedRepository=group` so objects a runner commits stay writable for both sides.
- the `runners` network, where they reach the office at `OFFICE_RUNNER_OFFICE_URL` (default `http://office:4600`) for agent hooks and the statusline. docker-proxy and Caddy are not on it.

Claude Code henchmen report to the office through `type: "command"` hooks and a statusline command: small scripts in `~/.regulus-office/claude/<henchman>/` that POST to `OFFICE_RUNNER_OFFICE_URL` with the henchman's token read from a 0600 file. Claude Code's `type: "http"` hooks are not used because Claude Code refuses them for any host that resolves to a private address, such as `office` on the `runners` network.

**Updating the agent CLIs.** The CLIs are pinned in `runner/Dockerfile` and do not update themselves inside runners (`DISABLE_AUTOUPDATER`/`DISABLE_UPDATES` for Claude Code, `check_for_update_on_startup = false` in `/etc/codex/config.toml` for Codex): they are root-owned and runners are not root. To update them, bump the version build args, and rebuild the runner image (`docker compose --profile build-only build runner-image`). The office moves each human's runner to the new image on its next use while it is idle; logins in the HOME volumes are kept.

After a Claude sign-in and before each Claude Code henchman starts, the office sets `hasCompletedOnboarding` in the runner's `~/.claude.json` (the CLI's own first-run flag; `claude auth login` does not set it) and, with `OFFICE_CLAUDE_TRUST_WORKTREES` (default `true`), `projects["<worktree>"].hasTrustDialogAccepted` for that henchman's own office-created worktree only. It runs a small script in the runner as the runner user, keeps every other key and never opens `~/.claude/`. A henchman that still shows Claude's sign-in or trust screen waits for its human, who finishes it in the henchman's terminal.

`docker compose exec -T office bun run - < runner-e2e.ts` runs the fake agent in a throwaway runner end to end. Runner containers and HOME volumes are created by the office, so `docker compose down -v` does not remove them; remove them first (this also frees the `runners` network): `docker rm -f $(docker ps -aq --filter label=org.regulus.office.prefix=<project>)`, then `docker volume rm $(docker volume ls -q --filter label=org.regulus.office.prefix=<project>)` if you also want to delete the logins. `<project>` is the Compose project name (`deploy` unless you pass `-p`).

### Connect GitHub

Operations work on GitHub repos. Connect the office to GitHub once, as an owner or admin, and **New operation…** lists every repo the connection can see (search, pick one: a room has exactly one repo, and it is built on the level of the GitHub organisation or account that owns the repo). Clones, fetches, pushes and one-click PRs then use the connection's token; a typed repo under *Other repo…* keeps its own optional token. Credentials are stored encrypted (so `OFFICE_MASTER_KEY` must be set), are never sent to browsers, logged or given to agents.

**GitHub App (recommended).** Settings → *GitHub* → type the organization (empty = your personal account) → *Create GitHub App…*. GitHub opens with a private app for this office already filled in; create it, then install it on the organization for all or selected repos. The office asks for Contents, Pull requests, Issues and Checks (read and write), Metadata (read) and, as an organization permission, Members (read). The app's private key and webhook secret are converted and stored by the office; nothing goes into `.env`. The office mints a one-hour installation token narrowed to one repo for each git or API call, and caches it until five minutes before it expires. To add repos later, change the installation's repository access on GitHub.

**An existing GitHub App.** Already have an app (say, from an earlier install)? Settings → *GitHub* → *Use an existing GitHub App…*. The form shows what to set on the app for this office: the webhook URL, the setup URL, the repository permissions and the events, all taken from the same list *Create GitHub App…* uses. Enter the *App ID*, pick the app's `.pem` private key (or paste it), and optionally a webhook secret and the client ID. GitHub never shows an app's old webhook secret again: generate a new one in the app's settings and paste it here, or leave it empty and an office with a public `https://` URL sets a new one on the app itself. The office checks the ID and key with GitHub (`GET /app` with an app JWT) before storing anything; a wrong pair is refused. If the app lacks a permission or event the office needs, it is connected anyway and the office lists what to add on GitHub. The key and secret are stored encrypted exactly like a created app's and are never shown again. Then install the app on the organization if it is not installed there yet. An app set in the environment (`GITHUB_APP_ID`) still takes precedence.

**Organization token (fallback).** On GitHub: Settings → Developer settings → Fine-grained tokens → *Generate new token*, resource owner = the organization, all or selected repositories, permissions *Contents: read and write*, *Pull requests: read and write*, *Metadata: read*. In the office: Settings → *GitHub* → paste it under *Or an organization access token* → *Connect with token*.

**Webhooks and polling (issue and PR boards).** The office keeps each operation's issue and PR boards in its database and pushes them to everyone in the operation. It learns about changes in one of two ways:

- *Webhooks* (App only, needs `OFFICE_PUBLIC_URL` to be a public `https://` URL). GitHub POSTs events to `https://<office>/api/github/webhook`. Every delivery must carry a valid `X-Hub-Signature-256` for the app's webhook secret; unsigned or badly signed deliveries are refused before their body is read as JSON, bodies over 4 MB are refused, the endpoint is rate limited, and a delivery id is handled only once (replays are dropped). No sign-in is involved. The office subscribes to Issues, Issue comments, Pull requests, Pull request reviews, Check suites, Check runs and Pushes; installation events arrive on their own.
- *Polling* (always available; the only way with an org token or a private URL). Every 60 s (`OFFICE_GITHUB_POLL_SECONDS`, 30–3600) the office asks GitHub for recently updated issues and PRs, their reviews and their checks with conditional requests. Unchanged answers are `304 Not Modified` and do not count against GitHub's rate limit; when the limit runs low the office waits for the reset. Once webhooks arrive, polling drops to a 10-minute catch-up. `OFFICE_GITHUB_POLLING=false` turns polling off. Repos without any token (public repos added without the connection) are not synced.

`GET /api/github/sync` (owners and admins) shows the mode, the webhook URL, whether a secret is set, the last delivery and poll, and any rate-limit pause.

*Apps created with a public `OFFICE_PUBLIC_URL`* already have the webhook on. *Apps created before this, or while the office had no public URL*, need it switched on once:

1. Set `OFFICE_PUBLIC_URL` to the office's public `https://` address and restart. At start the office sets the App's webhook URL to `https://<office>/api/github/webhook`, the content type to JSON and the secret (it creates and stores one if the App has none). GitHub's API cannot change the rest, so:
2. On GitHub: *Settings → Developer settings → GitHub Apps → <your office app> → Edit* (for an org app: the org's *Settings → Developer settings → GitHub Apps*). Under **General → Webhook**, tick **Active**, check that the URL is the one above, and save. Leave the secret alone: the office already set it.
3. Under **Permissions & events → Subscribe to events**, tick *Issues*, *Issue comment*, *Pull request*, *Pull request review*, *Check suite*, *Check run* and *Push*, and save. These need no new permissions, so installations do not have to approve anything.
4. Under **Advanced → Recent Deliveries**, the `ping` (or the next event) should show a green 2xx. `GET /api/github/sync` then reports `mode: "webhook"`.

With an env-configured App (`GITHUB_APP_ID`), set `GITHUB_WEBHOOK_SECRET` to the secret shown in the App's settings (or a new one you enter in both places).

**From the environment.** `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` (optionally `GITHUB_APP_CLIENT_ID`, `GITHUB_WEBHOOK_SECRET`) configure the App instead and override whatever was connected in the UI. `OFFICE_GITHUB_API_BASE` and `OFFICE_GITHUB_WEB_BASE` point at another GitHub (tests use a fake).

### Your own GitHub account

What a person can see in the office comes from **their own** GitHub access, not from their office role. Everyone links their GitHub account once: Settings → *You* → *Your GitHub account* → *Link GitHub account…*, approve on GitHub, done. The office then asks GitHub, with that person's token, what they may do on each repo the office has a room for, and keeps the answers: *read* or *triage* lets them view, *write* or *maintain* lets them work in the room, *admin* lets them manage it, and a repo they cannot see stays closed. The answers are checked again when the person signs in, every 15 minutes, when GitHub reports a change (collaborators, teams, organization members, repo visibility) and on *Check now*. If the person revokes the office on GitHub, or the token expires, everything closes until they link again. *Unlink* removes the token and the answers.

**Rooms follow it everywhere.** A room opens only for people whose own GitHub account can see its repo, and that holds for the office owner and admins too: their role runs the office (people, settings, shared agents, building rooms) and shows them no room their own account does not. A level is offered only to people with at least one room on it. On a level you can reach, a room you may not enter is a closed door: you get where it stands and nothing else (no name, no counts, no preview, no people inside). Everything about a closed room is closed with it: its boards, queue, changes, terminals, running apps, whiteboard, pictures, meetings, workflows, search hits, usage leaderboard entries, chat written inside it and notifications. When GitHub takes a permission away, open connections to that room are closed at once and the person is walked back to the lobby. A henchman whose owner lost the room finishes the task it is on, its pull request included, and takes nothing new from them; the owner can no longer open its terminal. Without a linked account a person is in the lobby only, and the lobby says "Link your GitHub account to enter your rooms."

**Shared agents follow it too.** An office (shared) agent has the rooms its admins gave it, but it tells a person, and does for them, only what that person's own GitHub access covers. While it answers someone, a room that is closed to them does not exist for it either ("no such operation", nothing about the room). What it saves to its memories and notes is kept with the rooms its conversation looked at, and reaches only people who can see all of those rooms: in a later chat with someone else, and for an admin reading its memories in Settings → *Agents*. The same holds for a question it puts to another person and for a chat line it posts. This is deliberately broad: something general it wrote down in a conversation that had looked at a room is treated as being about that room. An access code made for a shared agent reads what the person who made it can see; codes made before this version open no room, so make new ones. An agent a person stopped (its owner, or an admin with the emergency stop) has no body in the lair; it appears again when it is started or gets a message. An agent that merely is not running keeps its body: after an office restart or deploy the office PM is at reception and walks its rounds, and personal agents are beside their owners, as before.

- *Adding a room* needs the office owner or admin role **and** a linked account that can see the repo; the room is open to its creator the moment it exists, and to everyone else as soon as the office has asked GitHub about them (seconds).
- *Operation settings → Limits* can only lower what GitHub gives a person in one room (for example: view only). Nothing there lets anyone in.
- *Team notification channels* carry a room's events only while the person who set the channel up can see that room.
- *Emergency stop* stays an office action: `POST /api/users/<user id>/emergency-stop` (owners and admins) stops every running henchman of one person and answers two counts, nothing about rooms. In a room they can see, owners and admins also have the button on each henchman as before.
- A room without a repo (made before repos were required) keeps the old rule: owners and admins manage it, others need to have been added to it.

**Upgrading: rooms open with GitHub access.** The first start after this change closes every room for everyone, the owner included, until people link their accounts. Nothing is deleted and henchmen keep running; what you see is the lobby, the prompt "Link your GitHub account to enter your rooms." and no levels. Do this once:

1. Make sure `.env` has `OFFICE_MASTER_KEY`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (below) and that the callback URL is registered, then restart. Without them the prompt says linking is not set up and nobody can open a room.
2. Sign in and press *Link GitHub account…* in the lobby (or Settings → *You*). Your rooms and their levels appear as soon as GitHub has answered, without a reload.
3. Tell everyone else to do the same. People who used to be added to a room in *Operation settings* now need access to its repo on GitHub; an entry there no longer lets anyone in and, if it is lower than what GitHub gives them, still limits them. Remove such an entry (*Lift*) to give a person everything their GitHub permission allows.
4. Team notification channels start delivering again once the person who created each one has linked.

A room whose repo no owner or admin can see on GitHub cannot be archived, moved or deleted by them: give one of them access to the repo on GitHub first.

**Development without GitHub.** `bun run dev:github` starts a fake GitHub on port 4699 with three accounts (`ada-owner`, admin on every repo; `ben-member` and `cy-admin`, nothing until you give them a repo with `curl -X POST localhost:4699/__e2e/permission -H 'content-type: application/json' -d '{"login":"ben-member","repo":"octo/hello","permission":"read"}'`). Start the office with `OFFICE_GITHUB_API_BASE=http://127.0.0.1:4699 OFFICE_GITHUB_WEB_BASE=http://127.0.0.1:4699 GITHUB_CLIENT_ID=Iv1.e2efakeclient GITHUB_CLIENT_SECRET=e2e_fake_client_secret_0123456789abcdef` and an `OFFICE_MASTER_KEY`; *Link GitHub account…* then shows the fake's list of accounts. The end-to-end suites use the same fake. The office has no switch that opens rooms without GitHub: the development header (`x-office-dev-user`, never in production) signs a person in, and that person is in the lobby like anyone without a link.

The operator sets this up once with `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`, and `OFFICE_MASTER_KEY` (the token is stored encrypted, never shown, never given to a henchman):

- *Recommended:* the office GitHub App's own client. On GitHub open the app's settings → copy the *Client ID*, press *Generate a new client secret*, and add `https://<office>/api/github/link/callback` under *Callback URL*. A person's token is then limited to what both they and the app's installations can see.
- *Or* an OAuth App with the same callback URL (and `https://<office>/api/auth/callback/github` if you also use GitHub sign-in). The office then asks people for the `read:org` and `repo` scopes: GitHub has no narrower scope that covers private repos.

For changes to arrive at once rather than within 15 minutes, an App created before this feature needs *Organization permissions → Members: Read-only* and the events *Member*, *Membership*, *Organization*, *Repository* and *Team* (Settings → *GitHub* shows what is missing).

### GitHub workflows

An operation can run a review henchman whenever something happens on GitHub, and post what it finds **as the office's GitHub App** ("via Regulus Office"), never as a person. In an operation: top bar → *Workflows*. Everyone in the operation sees the workflows and their runs; office owners/admins and the operation's managers create and edit them.

- **Triggers:** a pull request opened, reopened, updated (new commits), ready for review or labeled; `/office <command>` in a PR comment or review (only from people with write access to the repo); an issue opened or labeled; a failed check; a push to a branch; a schedule (cron, UTC). **Filters:** repos, base branch, labels, authors, bot authors, changed paths and drafts.
- **Actions**, each off until you turn it on: a PR review (summary plus inline comments on changed lines; *request changes* only if allowed), a comment, labels from an allow-list, a neutral check run. *Approve* can only be turned on by an office owner or admin; without it an approving henchman posts a comment review, so the App never counts toward branch protection unless an admin allowed it. *Push fixes* is not available yet.
- **Models:** workflow henchmen run only on the office's own pay-per-use API keys (Connect providers → office key for Anthropic or OpenAI, added by an admin); usage is counted for `office`. Personal subscriptions are never used.
- **Limits** per workflow: runs at once, runs per day, tokens per day, and a cooldown per PR. The office runs at most three of them at once.
- **Dry run:** try a workflow (also unsaved edits) against a recent GitHub event of the operation: whether it would run, the prompt, what it would post. Nothing is posted.
- **Runs:** every run with its trigger, target, status, henchman, time, tokens, links to what it posted, and its log.

**Safety.** PR titles, bodies, diffs and comments are untrusted. The henchman reads a throwaway checkout of the PR head in its own sandbox as a separate runner identity (`officeworkflows`: no human's HOME, logins or clones), with no GitHub token, no git remote and only the model key in its environment. Claude runs `claude -p` with only the Read, Grep and Glob tools, allowed only inside the checkout (`Read(./**)`), with `/proc`, `/sys`, `/etc` and HOME denied, `--permission-mode dontAsk`, and without the checkout's settings or MCP servers; Codex runs `codex exec` in its read-only sandbox with its shell turned off, so it reads nothing but the prompt (Codex cannot limit reads to a directory). The henchman's answer is scrubbed before anything is posted or logged: if it contains the office key or the run's GitHub token (also split with invisible characters, base64-, URL- or hex-encoded) or anything shaped like a provider key, nothing is posted and the run fails with `secret_in_output` (audited). Neither runs the PR's code unless the workflow allows it, and never for fork PRs. Fork PRs get a comment review at most (no approve, request changes or labels). Events the App caused, comments the office posted and replayed deliveries never trigger a workflow; each delivery runs a workflow at most once. The office validates the henchman's answer before posting (inline comments only on changed lines, labels only from the list, mentions defused), and audits every GitHub write.

**An App created before workflows** has *Checks: Read-only*. For check runs: GitHub → *Settings → Developer settings → GitHub Apps → <your office app> → Permissions & events* → *Repository permissions* → **Checks: Read and write** → *Save changes*; then the org (or account) that installed it accepts the new permission under *Settings → GitHub Apps → <app> → Review request*. Pull requests, Issues and Contents are already read and write, and the events (Issues, Issue comment, Pull request, Pull request review, Check suite, Check run, Push) are the ones *Connect GitHub* above subscribes to. Webhooks need a public `OFFICE_PUBLIC_URL`; without them workflows see PRs and issues from polling (opened, closed, updated), but not comments, checks or pushes.

### Notifications

**For you.** The tab title shows how many of your henchmen wait for you, e.g. `(2) Regulus Office`. Settings → *Notifications* → *Allow desktop notifications*, then pick the events: needs input, asks for permission, done, error, PR opened, PR merged. Quiet hours use your computer's clock. You are only notified about your own henchmen; owners and admins can also opt in to anyone's henchman hitting an error. While the office tab has focus you get a toast instead; clicking a notification takes you to the henchman.

**For the team (owners and admins).** Settings → *Team notifications* → *Add channel…*, pick the service, name it, paste the URL or token, choose operations (all or some) and events, then *Send test*. Status events wait 5 s to settle (a henchman that asks and carries on sends nothing), repeats of one event per henchman are dropped for a minute, each henchman is capped at 8 team messages per 10 minutes, each channel sends at most one message per 1.1 s and 20 per minute, and failed deliveries are retried after 1, 5 and 25 s (honouring the service's `Retry-After`). Messages carry the henchman's name, owner, operation, status, task title and PR link, never terminal output or permission details. URLs and tokens need `OFFICE_MASTER_KEY`, are stored encrypted, and are never shown again or logged. A henchman's PR merge is noticed from GitHub webhooks, or from board polling when webhooks are off (see *Connect GitHub*), and notifies once, even if the henchman was already sent to barracks.

- **Slack** ([incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks)): [api.slack.com/apps](https://api.slack.com/apps) → *Create New App* → *From scratch* → *Incoming Webhooks* → turn on → *Add New Webhook to Workspace* → pick the channel → copy the `https://hooks.slack.com/services/…` URL.
- **Discord** ([webhooks](https://docs.discord.com/developers/resources/webhook#execute-webhook)): the channel's *Edit Channel* → *Integrations* → *Webhooks* → *New Webhook* → *Copy Webhook URL* (`https://discord.com/api/webhooks/…`). Messages never ping anyone (`allowed_mentions` is empty).
- **Telegram** ([Bot API](https://core.telegram.org/bots/api#sendmessage)): talk to [@BotFather](https://t.me/BotFather), `/newbot`, copy the token (`123456789:AA…`). Add the bot to the group (or as an admin of the channel), send `/start@<your_bot>` there (bots only see commands in groups by default), open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id` (groups start with `-100`; public channels can use `@name`). In the office paste the token and the chat id.

### Hermes run by the office

For someone without a Hermes of their own, and for agents the whole office shares, the office can run [Hermes Agent](https://github.com/NousResearch/hermes-agent) itself: Settings → *Agents* → *New agent…* → *Runs as*: **Hermes, run by the office (nothing to install)**. It is off until whoever runs the office turns it on; until then the choice is greyed out.

**Turning it on (the office operator, Docker deployments).** In `deploy/`:

```sh
docker compose --profile build-only build hermes-image   # about 1 GB to download, 4 GB on disk
echo 'OFFICE_HERMES_IMAGE=regulus-office-hermes:0.21.5' >> .env
docker compose up -d office
```

The image (`hermes-runner/Dockerfile`) is the official `nousresearch/hermes-agent` image pinned by digest to release `v2026.9.24` (Hermes 0.21.5, MIT licence), with a non-root user of the runner uid added and its own entrypoint removed; nothing else is installed. It is about 1 GB to download and about 4 GB on disk (it carries a browser and Hermes's full tool set), and shares no layers with the runner image; an idle Hermes uses about 300 MB of memory. To move to another Hermes release, change the tag and the digest in that file together, rebuild, and run `REGULUS_HERMES_IMAGE=<image> bun test apps/server/src/pm/hermes/managed/docker-host.integration.test.ts` (it starts the real gateway with dummy keys and calls no model). Only the Docker runner backend can run it; with `linux-user` the choice stays greyed out.

**What the office does.** For each such agent the office creates one container `<prefix>-hermes-<agent>` on the runners network, with the same hardening as a henchman's sandbox (non-root, no capabilities, `no-new-privileges`, memory, CPU and process limits; `OFFICE_HERMES_MEMORY`, `OFFICE_HERMES_CPUS`, `OFFICE_HERMES_PIDS`). Its only mount is its own volume `<prefix>-hermes-home-<agent>`, where Hermes keeps its sessions, memory and skills, so they survive restarts; it sees no operation directory and nobody's files. The office makes up the gateway's API key, starts `hermes gateway run` and waits for it to answer. The agent is started with the first message and stopped with *Stop*. If Hermes crashes or stops answering, the card shows Error with the reason and the office starts it again, with a pause that grows up to a minute. Removing the agent removes its container and its volume.

**What it runs on.** A pay-per-use key picked under *Runs on*: an **Anthropic API key** or a **DeepSeek** key, from "Connect providers". A shared agent runs on one of the office's own keys only; a personal agent on a key its owner picked. A subscription login cannot be used. Keys are handed to the Hermes process when it starts and are never written to disk, logged or shown. Other kinds of key (Z.AI, Kimi, custom endpoints) are not offered for Hermes yet.

**Office tools from the first message.** The office writes its own MCP address into the agent's Hermes configuration together with the agent's own access (kept in the process's environment, replaced at every start and revoked at stop), so there is nothing to copy. The agent's rights are those of its owner (personal) or what the office granted it (shared), within *What it may do*.

### Connect your own Hermes agent

If you already run a [Hermes Agent](https://github.com/NousResearch/hermes-agent) (for example a personal assistant you talk to over Telegram), you can talk to the same agent in the office. The office connects to your running Hermes and becomes one more channel to it; Telegram and its other channels keep working. Hermes keeps its own model, keys and memory: the office stores only how to reach it.

**First: can the office reach your Hermes?** This is where it usually fails. The office's *server* calls your Hermes, not your browser. The office runs in Docker, and inside a container `127.0.0.1` and `localhost` mean that container, not the machine it runs on. A Hermes that answers only on its own machine (`127.0.0.1:8642`, its default) therefore cannot be reached by the office, even when both are on the same computer. Make Hermes listen on an address the office's container can reach (set `API_SERVER_HOST`: on the same machine that is the host's address on the Docker network, otherwise its LAN or private-network address), allow that port for the office only, and enter that address in the office. *Test connection* in the form tells you whether the office's server gets through. The key lets its holder run commands through your Hermes, so never open the port to the internet unprotected.

**In Hermes** (checked against Hermes 0.21.5, release `v2026.9.24`; see its [API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) and [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) docs): turn on the API server. In `~/.hermes/.env` set `API_SERVER_ENABLED=true`, `API_SERVER_KEY` to a long random secret (`openssl rand -hex 32`; Hermes refuses a short one) and `API_SERVER_HOST` as above, then restart `hermes gateway`. Check on that machine: `curl http://<address>:8642/health` says `"platform": "hermes-agent"`. Telegram keeps answering.

**In the office:** Settings → *Agents* → *New agent…* → *Runs as*: **Connect my existing Hermes agent**. Enter the address (e.g. `http://my-server:8642`, or `http://my-server:8642/p/<profile>` for a named profile) and the access token (the `API_SERVER_KEY`), press *Test connection*, then *Create agent*. Such an agent is always personal: only you can talk to it, and nobody else, admins included, can use or read its connection. The address and the token are stored encrypted (so `OFFICE_MASTER_KEY` must be set), are never shown again, logged or given to other agents; to change them use *Replace connection…* on the agent's card. The card shows whether your Hermes can be reached; when it goes away the office keeps trying and says so, and a message that could not be delivered is answered with the reason.

**To let your Hermes use the office** (read operations, boards and queues, add tasks, comment, ask you a question): on the agent's card open *What it may do and where* → *Access codes for a program outside the office*, make a code, and add it to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  office:
    url: "https://<your office>/mcp"
    headers:
      Authorization: "Bearer <the access code>"
```

Then run `/reload-mcp` in Hermes or restart its gateway. With the code your Hermes acts in the office with exactly your rights and what you allowed under *What it may do*, from Telegram too; every call is checked and audited. Remove the code on the card to cut it off.

**One conversation or two.** By default the office has its own Hermes session, so the office and Telegram are two conversations with one agent that shares its memory (`MEMORY.md`, `USER.md`, search over past sessions). Under *More* you may instead name one existing Hermes session to continue (its id from `hermes sessions list`): office messages are then written into that conversation. This is experimental: answers to office messages appear only in the office, the id changes when you start a new conversation in Hermes (`/new`), and it has not been tried against a live Telegram session.

### Backups and restore

The `backup` service backs up the database every night at 03:00 UTC into `deploy/backups/` on the host (`OFFICE_BACKUP_HOST_DIR`, `OFFICE_BACKUP_TIME` and `OFFICE_BACKUP_RETENTION_DAYS` in `deploy/.env`), and once when it starts if the newest backup is more than a day old. That directory is not in the `office-data` volume, so deleting the volume (or `docker compose down -v`) leaves the backups alone. Each backup is a `sqlite3 .backup` snapshot, consistent while the office runs, that passed `PRAGMA integrity_check` before it was named `office-<UTC time>.db`; backups older than 14 days are deleted. The service runs the office image as uid 1000 with no network, no Docker socket, no secrets and a read-only root filesystem. `docker compose ps` shows it *unhealthy* when the newest backup is more than 26 hours old.

What is backed up: the SQLite database (accounts, rooms, henchmen, boards, settings, encrypted keys and the GitHub connection). Not backed up: terminal scrollback files, runner HOME volumes (provider logins; each person signs in again) and operation checkouts (they live on GitHub). Also keep `deploy/.env` safe: without the same `OFFICE_MASTER_KEY` a restored database cannot decrypt stored API keys or the GitHub connection. The backups sit on the same disk as the office, so copy them off the machine too, e.g. nightly `rsync -a deploy/backups/ backup-host:regulus-office/` or a Hetzner Storage Box (run it as root or uid 1000; the directory is private to uid 1000).

**What office agents are and remember is encrypted in the database.** Each agent's document ("who it is and how it works", with its history), its memories and its notes are stored encrypted with `OFFICE_MASTER_KEY`, like the stored API keys, so a backup file (or a copy of `office.db`) does not show them. This protects backups, not a live server's root: the running office holds the key and reads everything, and so can anyone who is root on its host or can read `deploy/.env`. Rows written by an older version are encrypted the first time the office starts with the key set (the log says how many), and the database file is rebuilt once so the old text is not left in it; backup files made before that still hold it until they are pruned (14 days by default), so delete older ones by hand if that matters. Not covered: conversations with agents and the questions agents put to people are stored as they are, and the CLI engine writes the agent's document and memories for each turn to `prompt.md` (mode 600) in its runner's HOME, which is not in the backup. Without `OFFICE_MASTER_KEY` nothing is encrypted and the office says so in its log at start. Lose the key and these texts cannot be read again, like the stored API keys.

```sh
cd deploy && docker compose exec backup scripts/backup.sh   # back up now
scripts/restore.sh                                          # list backups, from the repo root
scripts/restore.sh office-20261001-030000.db                # restore one (asks first; -y skips)
scripts/restore.sh /path/to/office-20261001-030000.db       # restore a copy from elsewhere
```

`scripts/restore.sh` stops `office` and `backup`, checks the backup's integrity, moves the current database aside inside the volume (`office.db.before-restore-<time>`, with its `-wal`/`-shm`), puts the backup in place as uid 1000 and starts the stack again. Runners and henchmen keep running. It works the same after the data volume was deleted: Compose creates an empty one, and the backup goes into it. By hand, from `deploy/` (`-p <project>` if not `deploy`):

```sh
docker compose stop office backup
docker compose run --rm --no-deps backup scripts/restore-db.sh /backups/office-20261001-030000.db
docker compose up -d --wait
```

A file from elsewhere is mounted in: `docker compose run --rm --no-deps -v /path/to/office-….db:/restore/office.db:ro backup scripts/restore-db.sh /restore/office.db`. It must be readable by uid 1000. CI runs this round trip on every change: back up, delete the data volume, restore, and check the owner account is back.

Developing instead? See [CONTRIBUTING.md](CONTRIBUTING.md): `bun install && bun run dev`. The browser smoke test runs with `bun run e2e` (needs `bunx playwright install chromium` once).

## Principles

- Real agents, real terminals. Nothing is faked.
- Structured by default, terminal on demand.
- Per-user credentials, always. The office never stores or shares subscription tokens.
- Operation = project, with its own room in the compound.
- Look like Game Dev Tycoon, run on a laptop.
- Self-hostable by one person with Docker Compose.

## Planned stack

Bun + TypeScript. React + Three.js (React Three Fiber) client. Colyseus rooms for multiplayer. Bun native PTY + tmux for terminals. Excalidraw + Yjs whiteboard. LiveKit for screen share and voice (optional). Better Auth. SQLite via Drizzle. GitHub App integration. Hermes Agent as the project-manager agent.

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
- **Network:** a public IPv4 or IPv6 address and a domain name for automatic TLS. Inbound TCP 80 and 443. With the optional media profile (LiveKit: voice and the lounge TV, `scripts/setup.sh --media`) also TCP 7881 and UDP 7882; UDP 3478 only with the optional TURN relay ([docs/deploy/media.md](docs/deploy/media.md)). Outbound HTTPS to GitHub and the AI provider APIs. Behind NAT or on a LAN, run it on a Tailscale/private network and use GitHub polling instead of webhooks.
- **Swap:** enable 2-4 GB of swap; agent memory use is spiky.
- **Backups:** the `backup` service copies the SQLite database nightly to `deploy/backups/`, outside the data volume ([Backups and restore](#backups-and-restore)); copy that directory and `deploy/.env` off the machine as well. Project repos live on GitHub anyway.

Visitors need a modern browser with WebGL2 (Chrome, Firefox, Safari, Edge) on a laptop with an integrated GPU or better; 1080p is the design target.

## Inspiration and credits

- [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) (MIT) for many of the office ideas.
- Game Dev Tycoon by Greenheart Games for the look. No assets from the game are used.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research (MIT). Nothing of it is in this repository: `hermes-runner/Dockerfile` builds on its official image, pinned by digest, for "Hermes run by the office".
- Character and furniture assets from Quaternius, Kenney and KayKit (CC0); attribution for CC-BY assets will live in `packages/assets/ATTRIBUTION.md`.

## License

MIT. See [LICENSE](LICENSE).
