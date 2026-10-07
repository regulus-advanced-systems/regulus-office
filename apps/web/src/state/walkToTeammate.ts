/**
 * Walk to a teammate (#49): plan an A* path through the compound (corridors
 * and doors, the player's own nav grid) to stand next to them. A teammate in
 * a room this viewer may not enter is walked to as far as its door: the
 * door stays shut on the nav grid, so the goal is the corridor in front of
 * it. Far away, the walk is a run.
 */
import type { Vec2 } from "@regulus/room-layout";
import { type CompoundWorld, isOpenRoom, roomAt, travelPose } from "../scene/compound/world.ts";
import { useBuildingStore } from "./building.ts";
import { useCompoundStore } from "./compound.ts";
import { onViewedLevel } from "./level.ts";
import { usePlayerStore } from "./player.ts";
import { travelToLevel } from "./travel.ts";

/** Stop this far from the teammate (metres), on the side we come from. */
export const BESIDE_METRES = 0.9;
/** Farther than this (metres, straight line) the walk is a run. */
export const RUN_BEYOND_METRES = 16;

export interface TeammateGoal extends Vec2 {
  /** The teammate is behind a door this viewer may not open: the goal is that door. */
  atDoor: boolean;
  /** The room the teammate is in, if any. */
  roomId: string | null;
}

/** Where to walk to reach a teammate standing at `them`, coming from `me`. */
export function teammateGoal(world: CompoundWorld, me: Vec2, them: Vec2): TeammateGoal {
  const room = roomAt(world, them.x, them.z);
  if (room && !isOpenRoom(room)) {
    const door = travelPose(room);
    return { x: door.x, z: door.z, atDoor: true, roomId: room.id };
  }
  const dx = me.x - them.x;
  const dz = me.z - them.z;
  const d = Math.hypot(dx, dz);
  const step = d > BESIDE_METRES ? BESIDE_METRES / d : 0;
  return { x: them.x + dx * step, z: them.z + dz * step, atDoor: false, roomId: room?.id ?? null };
}

export type WalkResult = "walking" | "door" | "here" | "unreachable" | "unknown";

/** Set off toward the human with this BuildingRoom session id. */
export function walkToTeammate(sessionId: string): WalkResult {
  const human = useBuildingStore.getState().state?.humans[sessionId];
  // Someone on another level (#268): go to their level first, then walk from its lift landing.
  if (human && !onViewedLevel(human) && !travelToLevel(human.levelId)) return "unknown";
  const world = useCompoundStore.getState().world;
  const them = human?.position;
  const player = usePlayerStore.getState();
  if (!world || !them || !player.spawned) return "unknown";
  const goal = teammateGoal(world, player, them);
  const far = Math.hypot(goal.x - player.x, goal.z - player.z);
  if (far < 0.3) return "here";
  const ok = player.setTarget(goal.x, goal.z, far > RUN_BEYOND_METRES);
  if (!ok) return "unreachable";
  return goal.atDoor ? "door" : "walking";
}
