/**
 * Quick travel (SPEC §9.1, #186; replaces the elevator): put the player in
 * the corridor right in front of a room's door, facing in, and optionally
 * walk on in. Used by the `F` menu, "Go to room" after a room is added,
 * search jumps and notifications. The OperationRoom join follows on its own as
 * soon as the player stands in the room (scene/compound/RoomPresence).
 */

import { LOBBY_OPERATION_ID } from "@regulus/protocol";
import type { Vec2 } from "@regulus/room-layout";
import { roomLayout } from "../scene/compound/layouts.ts";
import { lobbyOf, roomById, roomCentre, travelPose } from "../scene/compound/world.ts";
import { useBuildingStore } from "./building.ts";
import { syncCompoundWorld, useCompoundStore } from "./compound.ts";
import { isKnownLevel, levelOfOperation, useLevelStore } from "./level.ts";
import { usePlayerStore } from "./player.ts";

/** Look at another level: the world is rebuilt for it at once. False when it is not published. */
function showLevel(levelId: string): boolean {
  if (!isKnownLevel(useBuildingStore.getState().state, levelId)) return false;
  useLevelStore.getState().set(levelId);
  syncCompoundWorld();
  return true;
}

/**
 * Look at a level as soon as the building publishes it: a repo owner's first
 * room creates the level, and its state arrives a moment after the REST answer.
 */
export function showLevelWhenKnown(levelId: string, timeoutMs = 5000): void {
  if (useLevelStore.getState().levelId === levelId || showLevel(levelId)) return;
  const stop = () => {
    off();
    clearTimeout(timer);
  };
  const off = useBuildingStore.subscribe((s) => {
    if (!isKnownLevel(s.state, levelId)) return;
    stop();
    showLevel(levelId);
  });
  const timer = setTimeout(stop, timeoutMs);
}

/**
 * Go to another level (the plain level switch of #268; the lift is #269):
 * the player arrives in front of the lobby's door, which every level has in
 * the same place. False when the level is not known or the player has not spawned.
 */
export function travelToLevel(levelId: string): boolean {
  const player = usePlayerStore.getState();
  if (!player.spawned || !showLevel(levelId)) return false;
  const world = useCompoundStore.getState().world;
  const lobby = world ? lobbyOf(world) : undefined;
  if (lobby) player.spawnAt(travelPose(lobby), player.spawnKey ?? undefined);
  return true;
}

/** Rooms quick travel may pick: the special rooms and the finished rooms this viewer may enter. */
export function travelRoomIds(): string[] {
  const world = useCompoundStore.getState().world;
  if (!world) return [];
  return world.rooms.filter((r) => r.enterable && r.buildState === "ready").map((r) => r.id);
}

/**
 * Travel to a room's door; `walkIn` then walks the player into the room
 * (to `to`, room metres, or its middle). False when the room is not known
 * or not enterable, or the player has not spawned yet.
 */
export function travelTo(operationId: string, opts: { walkIn?: boolean; to?: Vec2 } = {}): boolean {
  // A project room on another level: look at that level first (#268).
  if (operationId !== LOBBY_OPERATION_ID) {
    const levelId = levelOfOperation(useBuildingStore.getState().state, operationId);
    if (levelId && levelId !== useLevelStore.getState().levelId) showLevel(levelId);
  }
  const world = useCompoundStore.getState().world;
  const room = world ? roomById(world, operationId) : undefined;
  const player = usePlayerStore.getState();
  if (!world || !room || !room.enterable || room.buildState !== "ready" || !player.spawned)
    return false;
  const pose = travelPose(room);
  player.spawnAt(pose, player.spawnKey ?? undefined);
  if (opts.walkIn) {
    // Just inside the door (the generated room's spawn point), or the middle of a special room.
    const inside = opts.to ?? (room.kind === "project" ? roomLayout(room)?.spawn : undefined);
    const at = inside
      ? { x: room.origin.x + inside.x, z: room.origin.z + inside.z }
      : roomCentre(room);
    usePlayerStore.getState().setTarget(at.x, at.z);
  }
  return true;
}
