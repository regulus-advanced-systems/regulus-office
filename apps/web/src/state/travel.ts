/**
 * Quick travel (SPEC §9.1, #186; replaces the elevator): put the player in
 * the corridor right in front of a room's door, facing in, and optionally
 * walk on in. Used by the `F` menu, "Go to room" after a room is added,
 * search jumps and notifications. The FloorRoom join follows on its own as
 * soon as the player stands in the room (scene/compound/RoomPresence).
 */
import type { Vec2 } from "@regulus/floor-layout";
import { roomLayout } from "../scene/compound/layouts.ts";
import { roomById, roomCentre, travelPose } from "../scene/compound/world.ts";
import { useCompoundStore } from "./compound.ts";
import { usePlayerStore } from "./player.ts";

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
export function travelTo(floorId: string, opts: { walkIn?: boolean; to?: Vec2 } = {}): boolean {
  const world = useCompoundStore.getState().world;
  const room = world ? roomById(world, floorId) : undefined;
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
