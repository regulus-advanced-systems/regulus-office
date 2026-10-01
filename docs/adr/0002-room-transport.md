# ADR 0002: Room transport

> Since #226, floors are called operations and robots henchmen.

Date: 2026-09-28. Status: accepted.

## Context
SPEC §4.2 picks Colyseus on `@colyseus/bun-websockets` for the low-rate shared
state (BuildingRoom, FloorRoom) and asks for it to sit behind a small
`RoomTransport` interface because upstream still labels the Bun transport
experimental (research 01 §2). SPEC §4.1 also wants one Bun process with one
listening socket that serves HTTP, rooms, terminal and Yjs WebSockets.

## Decision
- `apps/server/src/rooms/transport.ts` defines the seam: `RoomTransport`
  (`defineRoom`, `listen`, `attachment`, `broadcast`, `shutdown`),
  `RoomDefinition` (create/join/leave/message/dispose hooks plus
  `createState`), `RoomHandle` (state, clients, broadcast, interval) and
  `RoomClient` (session id, authenticated user, send, leave). Rooms such as
  `building/room.ts` import only these types and `@regulus/protocol`.
- `rooms/colyseus/` implements it with Colyseus 0.18. `EmbeddedBunWebSockets`
  subclasses the upstream transport but never calls `Bun.serve`; it exposes a
  `fetch` + `websocket` pair (`HttpAttachment`) that `http/server.ts` mounts in
  the existing `Bun.serve`, so matchmaking (`POST /matchmake/*`) and room
  sockets (`/<processId>/<roomId>`) share the office port. `room-adapter.ts`
  turns a `RoomDefinition` into a `Room` subclass whose static `onAuth` calls
  the injected `RoomAuth` with the matchmaking `Request`.
- Authentication is injected (`RoomAuth`), not imported from Better Auth,
  so #11 can plug in `getSessionFromRequest` at merge time. The Origin check
  for upgrades and matchmaking lives in the transport (`rooms/origin.ts`).
- State stays `@colyseus/schema` classes from `packages/protocol`; they are
  the wire format the web client decodes, independent of the transport.

## Raw Bun WebSocket fallback
If the Colyseus Bun transport has to go, a `BunRoomTransport` implements the
same interface in `rooms/bun/`:
- `attachment.fetch` handles `POST /rooms/<name>/join` (auth via `RoomAuth`,
  returns a session id) and upgrades `GET /rooms/<name>/<sessionId>`; the
  `websocket` handler maps sockets to `RoomClient`s.
- One instance per room name holds the `RoomDefinition`, its state and
  clients; `setInterval(patchRateMs)` runs `Encoder.encode()` from
  `@colyseus/schema` (usable without Colyseus core) and sends the delta
  frames; join sends `encodeAll()`. Messages are `{ type, payload }` msgpack
  or JSON frames dispatched to `definition.onMessage`.
- The web client swaps its `net/` adapter accordingly; `@colyseus/schema`'s
  decoder keeps working on both sides.
Nothing in `rooms/building/` or `packages/protocol` changes.

## Consequences
- Colyseus' matchmaker is module-global, so there is one `RoomTransport`
  per process; tests boot one server per file.
- Colyseus' own signal handlers and greeting are disabled; the office
  lifecycle controller shuts rooms down before HTTP and the database.
- Colyseus' permissive CORS defaults are not used; only the public origin
  (plus localhost outside production) may matchmake or upgrade.
- The FloorRoom (M1/M2) is another `RoomDefinition` on the same transport.
