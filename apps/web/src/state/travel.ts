/**
 * Quick travel (SPEC §9.1, #186; replaces the elevator): put the player in
 * the corridor right in front of a room's door, facing in, and optionally
 * walk on in. Used by the `F` menu, "Go to room" after a room is added,
 * search jumps and notifications. The OperationRoom join follows on its own as
 * soon as the player stands in the room (scene/compound/RoomPresence).
 */

import { LOBBY_LEVEL_ID, LOBBY_OPERATION_ID } from "@regulus/protocol";
import type { Pose, Vec2 } from "@regulus/room-layout";
import { roomLayout } from "../scene/compound/layouts.ts";
import { liftOf } from "../scene/compound/lift/spot.ts";
import { roomById, roomCentre, travelPose } from "../scene/compound/world.ts";
import { useBuildingStore } from "./building.ts";
import { syncCompoundWorld, useCompoundStore } from "./compound.ts";
import { DRAFT_LEVEL_ID, isKnownLevel, levelOfOperation, useLevelStore } from "./level.ts";
import { usePlayerStore } from "./player.ts";

/** The fixed rooms that only the lobby level has. */
const LOBBY_LEVEL_ROOMS: ReadonlySet<string> = new Set([
  LOBBY_OPERATION_ID,
  "conference",
  "break_room",
]);

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
 * Where someone arriving on the level being looked at appears: in front of
 * the lift on that level's landing (the lobby on the lobby level), facing
 * away from it, as if they had just stepped out.
 */
export function levelArrivalPose(): Pose | null {
  const world = useCompoundStore.getState().world;
  return world ? (liftOf(world)?.stand ?? null) : null;
}

/**
 * Go to another level (D26; #268, #269): the world becomes that level and the
 * player stands at its lift landing. This is the one way to change level: the
 * lift (state/lift.ts plays its ride around this call), quick travel, "who's
 * where" and anything that follows the player between levels all call it.
 * False when the level is not one this viewer is shown (unknown, or not
 * reachable: the server does not publish those) or the player has not spawned.
 */
export function travelToLevel(levelId: string): boolean {
  const player = usePlayerStore.getState();
  if (levelId === DRAFT_LEVEL_ID || !player.spawned || !showLevel(levelId)) return false;
  const pose = levelArrivalPose();
  if (pose) player.spawnAt(pose, player.spawnKey ?? undefined);
  return true;
}

/**
 * Build mode is about to place the first room of a GitHub owner who has no
 * level yet (#269): look at the empty grid that level will have. `leaveDraftLevel`
 * goes back when build mode ends, wherever the player was before.
 */
export function showDraftLevel(): void {
  // Nothing published yet: there is no grid to derive the new level's from.
  if (!useBuildingStore.getState().state) return;
  const level = useLevelStore.getState();
  if (level.levelId !== DRAFT_LEVEL_ID) beforeDraft = level.levelId;
  level.set(DRAFT_LEVEL_ID);
  syncCompoundWorld();
}

let beforeDraft: string = LOBBY_LEVEL_ID;

/** Back from the draft level to the level looked at before it (the lobby level if that is gone). */
export function leaveDraftLevel(): void {
  if (useLevelStore.getState().levelId !== DRAFT_LEVEL_ID) return;
  if (!showLevel(beforeDraft)) showLevel(LOBBY_LEVEL_ID);
}

/** Rooms quick travel may pick on this level: its fixed rooms and the finished rooms this viewer may enter. */
export function travelRoomIds(): string[] {
  const world = useCompoundStore.getState().world;
  if (!world) return [];
  return world.rooms.filter((r) => r.enterable && r.buildState === "ready").map((r) => r.id);
}

/**
 * Travel to a room's door; `walkIn` then walks the player into the room
 * (to `to`, room metres, or its middle). False when the room is not known
 * or not enterable (a closed room never is), or the player has not spawned yet.
 */
export function travelTo(
  operationId: string,
  opts: { walkIn?: boolean; to?: Vec2; levelId?: string } = {},
): boolean {
  // A room on another level: go to that level first (#268). A project room is on its
  // repo owner's level; the lobby, war room and break room are on the lobby level (#269);
  // a landing is the one of `opts.levelId`, else of the level being looked at.
  const levelId =
    opts.levelId ??
    (LOBBY_LEVEL_ROOMS.has(operationId)
      ? LOBBY_LEVEL_ID
      : levelOfOperation(useBuildingStore.getState().state, operationId));
  if (levelId && levelId !== useLevelStore.getState().levelId) showLevel(levelId);
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
