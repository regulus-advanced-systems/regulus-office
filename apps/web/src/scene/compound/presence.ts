/**
 * Which FloorRooms to be in (SPEC §9.1, #186): the room the player stands in
 * plus up to three of the nearest rooms on screen that this viewer may see
 * into. A room that drops out of the pick lingers a few seconds before it is
 * left, so walking along a corridor or turning the camera does not churn
 * joins. Pure; `RoomPresence.tsx` feeds it the camera's view.
 */
import { MAX_NEARBY_ROOMS } from "../../net/floorLinks.ts";
import { type CompoundWorld, currentFloorAt, distanceToRoom, isOpenRoom } from "./world.ts";

/** How long a room stays joined after it leaves the pick, ms. */
export const LINGER_MS = 4000;

export interface RoomPick {
  current: string | null;
  nearby: string[];
}

export interface PresenceMemory {
  /** Floor id → when it was last picked. */
  lastPicked: Map<string, number>;
}

export function createPresenceMemory(): PresenceMemory {
  return { lastPicked: new Map() };
}

/**
 * The pick for a player at `(x, z)` with `visible` rooms on screen. `memory`
 * carries the linger between calls.
 */
export function pickRooms(
  world: CompoundWorld,
  player: { x: number; z: number },
  visible: ReadonlySet<string>,
  memory: PresenceMemory,
  now: number,
): RoomPick {
  const here = currentFloorAt(world, player.x, player.z);
  const hereRoom = here ? world.rooms.find((r) => r.id === here) : undefined;
  const current = hereRoom && isOpenRoom(hereRoom) ? here : null;
  const open = world.rooms.filter((r) => r.kind === "project" && r.id !== current && isOpenRoom(r));
  const byDistance = (ids: string[]) =>
    ids
      .map((id) => {
        const room = open.find((r) => r.id === id);
        return {
          id,
          d: room ? distanceToRoom(room, player.x, player.z) : Number.POSITIVE_INFINITY,
        };
      })
      .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
      .map((e) => e.id);
  const fresh = byDistance(open.filter((r) => visible.has(r.id)).map((r) => r.id)).slice(
    0,
    MAX_NEARBY_ROOMS,
  );
  for (const id of fresh) memory.lastPicked.set(id, now);
  const openIds = new Set(open.map((r) => r.id));
  const lingering = byDistance(
    [...memory.lastPicked.entries()]
      .filter(([id, at]) => !fresh.includes(id) && openIds.has(id) && now - at < LINGER_MS)
      .map(([id]) => id),
  );
  for (const [id, at] of memory.lastPicked)
    if (!openIds.has(id) || now - at >= LINGER_MS) memory.lastPicked.delete(id);
  return { current, nearby: [...fresh, ...lingering].slice(0, MAX_NEARBY_ROOMS) };
}

export function samePick(a: RoomPick | null, b: RoomPick): boolean {
  return (
    a !== null &&
    a.current === b.current &&
    a.nearby.length === b.nearby.length &&
    a.nearby.every((id, i) => id === b.nearby[i])
  );
}
