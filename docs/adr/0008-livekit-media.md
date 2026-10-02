# 0008: Voice and the lounge TV on LiveKit

## Context

M3 (#48, D5) adds proximity voice chat and screen sharing to the lobby's
lounge TV on a self-hosted LiveKit SFU under the Compose profile `media`
(research 01 §4). The office must work without it, must never carry media
itself, and must keep SPEC §8 and §9.1 intact: secrets only in env, and a
project room's interior (here: what is said in it) private to its members.

## Decision

- **Tokens**: the office server mints LiveKit access tokens (HS256 JWT, its
  own twenty lines rather than livekit-server-sdk) at `POST /api/media/token`,
  only for a signed-in human, same-origin, for one of their own building
  room sessions, valid 10 minutes. The identity is that session id, so every
  client maps a LiveKit participant to an avatar. Grants per role
  (protocol `mediaGrantsFor`): owners, admins and members subscribe and
  publish microphone and screen; viewers only subscribe (SPEC §3 "walk around
  and watch", D12 "control nothing", like the jukebox). Nobody gets data
  messages or may change their own name or metadata.
- **One LiveKit room per office**, not one per zone. Proximity is a client
  matter (audio/spatial.ts curve, straight-line distance, room occlusion), so
  zones would only add reconnects at every doorway and lose voices heard
  through one. Bandwidth stays bounded because each client subscribes to the
  nearest 12 audible voices only (`autoSubscribe: false`, hysteresis at the
  edge), and to the TV's screen only while it is in range or open.
- **Privacy is enforced by the SFU, not the listener**: a publisher in a
  project room sets track subscription permissions so only the humans the
  office placed in that room (their `operationId`, granted only with room
  access) may receive their mic; in the lobby, corridors and special rooms
  everyone may. A modified client can turn up a far voice in public areas
  (as it could walk there), but not hear into a room it may not enter.
- **The TV belongs to the building room**: `screen.share.start` sets the
  sharer's `HumanPresence.sharingScreen` (one at a time, lobby only, not
  viewers); `screen.share.stop` by the sharer, or by an owner/admin for
  someone else's share (audited). Every client draws the TV from the
  participant the office names, so a screen published without its say-so
  never reaches the TV. The sharer picks the screen inside the click's
  gesture first, then asks the office, then publishes.
- **Ports**: signalling through the existing Caddy on 443 (`/livekit`),
  media over one muxed UDP port (7882) plus TCP 7881, published from a
  bridge-networked container; the generated `livekit.yaml` (Compose
  `configs.content`) holds no secret, the key pair comes from `LIVEKIT_KEYS`.
  TURN is optional and documented (docs/deploy/media.md).

## Consequences

- An office without the profile behaves as before; the HUD hides voice and
  sharing and says how to enable them.
- Only three firewall rules for a VPS, no extra certificate or hostname.
- Very large offices should move to a UDP port range with host networking
  (documented); the single port is LiveKit's mux and fine for a team.
- Speaking and mute state are LiveKit's (active speakers, track mute), not
  room state, so they cost the office server nothing.
