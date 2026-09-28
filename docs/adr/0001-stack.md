# ADR 0001: Core stack

Date: 2026-09-28. Status: accepted.

## Context
We need a browser-based, multiplayer, self-hosted office simulator that embeds real AI coding agent processes and supports both an isometric third-person view and a first-person toggle. See `docs/research/01-tech-stack.md`.

## Decision
- Bun + TypeScript monorepo (Bun workspaces).
- Client: Vite, React, Three.js via React Three Fiber and drei, zustand.
- Multiplayer: Colyseus with the Bun WebSocket transport, behind a small transport interface.
- Terminals: Bun native PTY attaching to tmux sessions; xterm.js in the browser.
- Whiteboard: Excalidraw + Yjs. tldraw rejected on licensing grounds.
- Media: LiveKit self-hosted, optional Compose profile.
- Auth: Better Auth. DB: SQLite (bun:sqlite, WAL) via Drizzle. Postgres optional later.
- Packaging: Docker Compose; agents run in per-human runner containers or per-human Linux users.

## Consequences
- One asset pipeline serves both camera modes.
- Colyseus on Bun is labelled experimental upstream; the transport interface keeps a raw Bun WebSocket fallback cheap.
- DOM-in-3D (terminals on laptop screens) is limited to one or two live panels; other screens are textures.
