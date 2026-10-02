/**
 * Where the lounge TV stands (#48, SPEC §9.4): the lobby dressing places it
 * across the coffee table from the sofa (compound/special.ts); this turns
 * it into compound metres, with the spot in front of it where `E` opens it
 * full screen. Sitting on the sofa (#49 seats `sofa-1..3`) focuses it too.
 */
import { LOBBY_OPERATION_ID, parseSeatKey } from "@regulus/protocol";
import { DIRECTION, HEADING } from "@regulus/room-layout";
import { specialDressing } from "../compound/special.ts";
import { type CompoundWorld, lobbyOf } from "../compound/world.ts";

export interface TvSpot {
  /** Centre of the set's footprint, compound metres. */
  x: number;
  z: number;
  /** Footprint, metres. */
  w: number;
  d: number;
  /** Heading the screen faces (radians, the room-layout convention). */
  heading: number;
  screen: { w: number; h: number; y: number };
  /** Where a player stands to use it. */
  stand: { x: number; z: number };
  roomId: string;
}

/** From this far (metres) from `stand`, `E` opens the TV. */
export const TV_REACH = 1.8;
/** Within this many metres of the TV (in the lobby) the screen is received and drawn. */
export const TV_WATCH_RANGE = 18;

export function tvSpot(world: CompoundWorld | null): TvSpot | null {
  const lobby = world ? lobbyOf(world) : undefined;
  if (!lobby) return null;
  const tv = specialDressing("lobby", lobby.size.w, lobby.size.d).tv;
  if (!tv) return null;
  const x = lobby.origin.x + tv.rect.x + tv.rect.w / 2;
  const z = lobby.origin.z + tv.rect.z + tv.rect.d / 2;
  const front = DIRECTION[tv.facing];
  const reach = tv.rect.d / 2 + 0.8;
  return {
    x,
    z,
    w: tv.rect.w,
    d: tv.rect.d,
    heading: HEADING[tv.facing],
    screen: tv.screen,
    stand: { x: x + front.x * reach, z: z + front.z * reach },
    roomId: lobby.id,
  };
}

/** Is this seat key one of the lobby sofa's seats (the ones facing the TV)? */
export function isTvSofaSeat(seatKey: string | null | undefined): boolean {
  const parsed = seatKey ? parseSeatKey(seatKey) : null;
  return parsed?.roomId === LOBBY_OPERATION_ID && /^sofa-\d+$/.test(parsed.seatId);
}

/** Is a player at `(x, z)` in range to watch the TV? */
export function inTvRange(spot: TvSpot | null, x: number, z: number, roomId: string | null) {
  if (!spot || roomId !== spot.roomId) return false;
  return Math.hypot(x - spot.x, z - spot.z) <= TV_WATCH_RANGE;
}
