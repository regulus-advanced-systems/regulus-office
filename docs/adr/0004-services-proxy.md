# ADR 0004: Running apps discovery and the services proxy

Date: 2026-09-30. Status: accepted (#39; SPEC §9.4, research 01 §12).

## Context
Robots start dev servers in their own sandboxes (ADR 0003): a container on the
runners network (docker) or a network namespace behind an isolated bridge
(linux-user). Nothing is published on the host. Humans want to open those apps
from the office, teammates included, without the office becoming an open proxy
and without giving a robot's code a way into the office or into another
human's sandbox (SPEC §8, D12).

## Decision
- **Discovery.** Every 2.5 s the office asks the runner for the LISTEN sockets
  of each running robot's sandbox (`Runner.listPorts`, which reads
  `/proc/net/tcp{,6}` inside the robot's container or network namespace and
  maps socket inodes to the sandbox's pids) and where the sandbox is reached
  (`Runner.sandboxOf`, new: container name or bridge address). One service per
  robot and port; a port bound only to loopback in a sandbox is listed as
  "localhost only". New ports are titled from the robot's terminal (the dev
  server's banner above the URL it printed), then the page `<title>`, then the
  process name. Quiet robots are scanned every 10 s. Services are published to
  the FloorRoom and kept in the `services` table.
- **URL.** `/p/<floorId>/a/<agentId>/port/<n>/`, not `/p/<floor>/port/<n>/` as
  first sketched: with per-robot network namespaces two robots on one floor can
  both listen on 3000, so the robot is part of the key.
- **No open proxy.** The proxy connects only to a port the last scan found
  listening in that robot's sandbox, at the address the runner gave for it.
  The request never names a host; the upstream URL is built by concatenation
  and checked; redirects are not followed; the office's own port on loopback
  is refused.
- **Credentials.** Office cookies and `x-office-*` headers are stripped before
  forwarding; `Set-Cookie` for office cookie names is dropped, `Domain` is
  removed and (path mode) `Path` is pinned under the prefix; `Clear-Site-Data`
  and `Service-Worker-Allowed` are dropped.
- **Who opens what (D12 spirit).** Floor visibility is required (else 404).
  The robot's owner gets full access. Everyone else with floor access watches:
  GET/HEAD only, and WebSocket frames from the app only (like `attach -r`),
  because the app runs in another human's sandbox with their CLI logins.
- **Two modes.** *Path mode* (default) serves apps on the office's origin, so
  an app's scripts would run with the viewer's office session; there only the
  robot's owner may open it. *App domain mode* (`OFFICE_SERVICES_DOMAIN`)
  serves each app on `<port>-<agentId>.<domain>`: the office checks the session
  and redirects with a one-time HMAC ticket, the app host swaps it for its own
  host-only cookie, and every request re-checks floor access. Watchers are
  allowed only in this mode.
- **No `HOST=0.0.0.0` in the sandbox env.** Few dev servers read it (Vite,
  Next.js, Astro do not), zsh overwrites `HOST` with the host name, and on
  docker every sandbox shares the runners network, so a default wide bind would
  expose every robot's dev server to other humans' robots. The panel says when
  a server listens on localhost only and how to bind it wide instead.

## Consequences
- Apps behind the path prefix must be told their base (Vite `base`, Next.js
  `basePath`); app domain mode serves them at `/`. See
  `docs/deploy/services-proxy.md`.
- App domain mode needs a wildcard DNS record and certificate.
- A docker dev server bound wide can be reached by other sandboxes on the
  runners network (as before, ADR 0003). Per-human networks are future work.
