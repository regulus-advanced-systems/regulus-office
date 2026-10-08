/**
 * Where the reception desk stands (#60): the shared numbers of
 * `receptionSpec` (packages/room-layout) turned into compound metres, for the
 * desk's click target and the spot a visitor talks from.
 */
import { RECEPTION_REACH, type Rect, receptionSpec, type Vec2 } from "@regulus/room-layout";
import { type CompoundWorld, lobbyOf } from "../compound/world.ts";

export interface ReceptionSpot {
  /** The counter's footprint, compound metres. */
  desk: Rect;
  /** Where a visitor stands to talk across the counter. */
  stand: Vec2;
  /** Where the office PM stands behind it. */
  post: Vec2;
}

export { RECEPTION_REACH };

export function receptionSpot(world: CompoundWorld): ReceptionSpot | null {
  const lobby = lobbyOf(world);
  if (!lobby) return null;
  const spec = receptionSpec(lobby.size.w, lobby.size.d);
  const at = (p: Vec2): Vec2 => ({ x: lobby.origin.x + p.x, z: lobby.origin.z + p.z });
  return {
    desk: { ...at(spec.desk), w: spec.desk.w, d: spec.desk.d },
    stand: at(spec.visitor),
    post: at(spec.post),
  };
}

/** Is a player at `p` at the desk (close enough to talk across it)? */
export const atDesk = (spot: ReceptionSpot, p: Vec2): boolean =>
  Math.hypot(p.x - spot.stand.x, p.z - spot.stand.z) <= RECEPTION_REACH;
