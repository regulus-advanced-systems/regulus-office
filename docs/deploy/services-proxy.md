# Running apps: the services proxy

Henchmen's dev servers show up in the **Running apps** panel of their room with an
**Open** button. The office finds them by listing the listening sockets in each
henchman's sandbox every few seconds and proxies them with authentication. Design:
`docs/adr/0004-services-proxy.md`.

## What a henchman's server needs
- **Listen on `0.0.0.0`, not `localhost`.** The office reaches a sandbox over
  the network (docker: the runners network; linux-user: the sandbox bridge).
  A server bound to `127.0.0.1` inside the sandbox is listed as
  "localhost only" and cannot be opened. Vite: `vite --host`
  (`server.host: true`); Next.js: `next dev -H 0.0.0.0`; Astro: `--host`;
  most others: `--host 0.0.0.0`.
- **Use `$PORT`** where possible. Every sandbox gets its own range
  (`PORT`, `OFFICE_SANDBOX_PORTS`); any port works, though.

## Path mode (default)
Apps open at `/p/<floorId>/a/<agentId>/port/<n>/` on the office's own origin.

- **Only the henchman's owner can open it.** On the office origin the app's
  scripts run with the viewer's office session; letting other people run a
  henchman's code that way would let the henchman act as them. Teammates see the app
  in the list but need app domain mode (below) to open it.
- **The prefix is passed through unchanged**, so the app must know it is served
  under it, or its absolute links (`/assets/…`, `/@vite/client`) go to the
  office instead:
  - Vite: `vite --host --base /p/<floorId>/a/<agentId>/port/$PORT/`
    (HMR then connects through the proxy as well);
  - Next.js: `basePath`; CRA: `PUBLIC_URL`; others: their base/prefix option.
  - The path is in the panel's Open link, and in `X-Forwarded-Prefix`.
- Even for the owner, the app runs on the office origin. Cookies it sets are
  scoped to its prefix and can never replace the office's; it cannot clear site
  data or register a service worker beyond its prefix.

## App domain mode (recommended for teams)
Set `OFFICE_SERVICES_DOMAIN`, e.g. `apps.office.example`. Each app then lives on
its own origin, `https://<port>-<agentId>.apps.office.example`, and is served
at `/` (no base path needed). Open goes through the office, which checks the
session and redirects with a one-time ticket; the app host sets its own cookie.

- The henchman's owner gets full access; everyone else who can see the room may
  **watch** the app: pages load (GET/HEAD), live reload works, but forms, API
  writes and WebSocket messages from them are not passed on (D12).
- DNS: a wildcard record `*.apps.office.example` pointing at the office.
- TLS: a wildcard certificate, or Caddy's on-demand TLS. With Caddy:

  ```
  *.apps.office.example {
      tls {
          on_demand
      }
      reverse_proxy office:4600
  }
  ```

  and an `on_demand_tls { ask … }` endpoint or a DNS-01 wildcard certificate,
  as your DNS provider allows. Keep the `Host` header (Caddy does by default).
- The domain must not be the office's own host name. A subdomain of the
  office's domain is same-site with it: browsers then send the office's
  (SameSite=Lax) cookie with requests an app makes to the office, and the
  office's Origin checks are what stop them. A separate registrable domain
  (e.g. `office-apps.example` for `office.example`) removes even that.

## Refusals you may see
| Status | Why |
|---|---|
| 401 | Not signed in (path mode), or no app cookie (app domain, non-GET) |
| 403 | Not the henchman's owner in path mode; cross-origin request |
| 404 | No such app: not your room, the port is not listening, or the henchman is gone |
| 405 | Watching read-only (app domain mode) |
| 502 | Localhost only, or the app does not answer |
