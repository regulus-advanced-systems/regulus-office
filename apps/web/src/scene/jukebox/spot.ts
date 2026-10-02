/**
 * Where the lobby jukebox stands (#47): the lobby dressing places it
 * (compound/special.ts), so this finds it there and turns it into compound
 * metres, with the spot in front of it where a player stands to use it.
 */
import { DIRECTION } from "@regulus/room-layout";
import { specialDressing } from "../compound/special.ts";
import { type CompoundWorld, lobbyOf } from "../compound/world.ts";

export interface JukeboxSpot {
  /** Centre of the jukebox, compound metres. */
  x: number;
  z: number;
  /** Footprint, metres. */
  w: number;
  d: number;
  /** Where a player stands to use it. */
  stand: { x: number; z: number };
  /** The lobby's room id: the jukebox is heard best inside it. */
  roomId: string;
}

/** From this far (metres) from `stand`, `E` opens the jukebox. */
export const JUKEBOX_REACH = 1.8;

export function jukeboxSpot(world: CompoundWorld): JukeboxSpot | null {
  const lobby = lobbyOf(world);
  if (!lobby) return null;
  const item = specialDressing("lobby", lobby.size.w, lobby.size.d).furniture.find(
    (f) => f.model === "jukebox",
  );
  if (!item) return null;
  const x = lobby.origin.x + item.rect.x + item.rect.w / 2;
  const z = lobby.origin.z + item.rect.z + item.rect.d / 2;
  const facing = DIRECTION[item.facing];
  const reach = Math.max(item.rect.w, item.rect.d) / 2 + 0.7;
  return {
    x,
    z,
    w: item.rect.w,
    d: item.rect.d,
    stand: { x: x + facing.x * reach, z: z + facing.z * reach },
    roomId: lobby.id,
  };
}
