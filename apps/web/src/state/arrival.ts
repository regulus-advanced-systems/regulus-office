/**
 * Where the player appears when the office opens (#262): where the building
 * says they are. The server remembers each person's last place and, when
 * they join, puts their presence back on that level, in that room, at that
 * spot (when they may still be there), or at the lobby spawn. This client
 * starts from that presence instead of always starting in the lobby.
 *
 * Only before the player's first spawn: from then on the client moves the
 * player and the building follows (`move`, `operation.go`), also across
 * reconnects. Nothing here knows whether a remembered place was refused: a
 * person who lost a room simply reads "lobby" like everybody else.
 */
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import type { NavGrid, Pose } from "@regulus/room-layout";
import type { CompoundWorld } from "../scene/compound/world.ts";
import { nearestWalkable } from "../scene/movement/navigation.ts";
import { selectSelf, useBuildingStore } from "./building.ts";
import { isKnownLevel, useLevelStore } from "./level.ts";
import { usePlayerStore } from "./player.ts";

/** Closer than this to the usual spawn is the usual spawn, metres. */
const SAME_SPOT = 0.05;

/** Our own presence while the player has not spawned yet; null afterwards. */
function arrivingSelf() {
  if (usePlayerStore.getState().spawned) return null;
  return selectSelf(useBuildingStore.getState());
}

/**
 * Look at the level the building has us on, before the world is first built.
 * Called whenever the world is worked out (state/compound.ts); it does
 * nothing once the player has spawned, or while that level is not published
 * to us.
 */
export function adoptArrivalLevel(): void {
  const self = arrivingSelf();
  if (!self) return;
  const levelId = self.levelId || LOBBY_LEVEL_ID;
  const level = useLevelStore.getState();
  if (level.levelId !== LOBBY_LEVEL_ID || levelId === LOBBY_LEVEL_ID) return;
  if (!isKnownLevel(useBuildingStore.getState().state, levelId)) return;
  level.set(levelId);
}

/**
 * The pose the player first spawns at in `world`: where the building has
 * them, moved onto the nearest floor of this client's own nav grid (which
 * knows the furniture the server's does not), or `spawn` (the usual one)
 * when the building has them on another level, at the usual spot, or
 * nowhere this client can stand.
 */
export function arrivalPose(world: CompoundWorld, grid: NavGrid, spawn: Pose): Pose {
  const self = arrivingSelf();
  if (!self || (self.levelId || LOBBY_LEVEL_ID) !== world.levelId) return spawn;
  const { x, z, heading } = self.position;
  if (Math.hypot(x - spawn.x, z - spawn.z) < SAME_SPOT)
    return heading === spawn.heading ? spawn : { ...spawn, heading };
  const at = nearestWalkable(grid, { x, z });
  return at ? { x: at.x, z: at.z, heading } : spawn;
}
