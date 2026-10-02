/**
 * Who is where (#49): one row per human in the office with the place they
 * are in (a room's name, a corridor, the beach) and what they are doing
 * (their `doing` status, or sitting). Pure: built from the BuildingRoom
 * presence map and the client's compound world.
 */
import type { BuildingState, HumanPresence } from "@regulus/protocol";
import { type CompoundWorld, roomAt } from "../../scene/compound/world.ts";

export type Zone = "room" | "corridor" | "outside" | "unknown";

export interface Place {
  label: string;
  zone: Zone;
  /** The room's id when in one. */
  roomId: string | null;
}

export interface WhereaboutsRow {
  sessionId: string;
  userId: string;
  name: string;
  place: Place;
  doing: string;
  seated: boolean;
  self: boolean;
}

/** Where a compound point is, in words. */
export function placeAt(world: CompoundWorld | null, x: number, z: number): Place {
  if (!world) return { label: "In the office", zone: "unknown", roomId: null };
  const room = roomAt(world, x, z);
  if (room) return { label: room.name, zone: "room", roomId: room.id };
  const m = world.tileMetres;
  if (z >= world.depth * m) return { label: "On the beach", zone: "outside", roomId: null };
  const tx = Math.floor(x / m);
  const tz = Math.floor(z / m);
  const inCorridor = world.corridors.some(
    (c) => tx >= c.x && tx < c.x + c.w && tz >= c.y && tz < c.y + c.d,
  );
  return inCorridor
    ? { label: "In a corridor", zone: "corridor", roomId: null }
    : { label: "In the compound", zone: "unknown", roomId: null };
}

/** The status line under a name: what they said they are doing, else sitting. */
export function doingLine(h: Pick<HumanPresence, "doing" | "seatId">): string {
  if (h.doing) return h.doing;
  return h.seatId ? "sitting down" : "";
}

/**
 * Rows for every human, the viewer first and then by name; a human with
 * several tabs open is listed once (their newest session).
 */
export function whereaboutsRows(
  state: Pick<BuildingState, "humans"> | null | undefined,
  world: CompoundWorld | null,
  selfSessionId: string | null,
): WhereaboutsRow[] {
  const humans = Object.entries(state?.humans ?? {});
  const selfUser = selfSessionId ? state?.humans[selfSessionId]?.userId : undefined;
  const newest = new Map<string, [string, HumanPresence]>();
  for (const [id, h] of humans) {
    const prev = newest.get(h.userId);
    const mine = id === selfSessionId;
    if (!prev || mine || (prev[0] !== selfSessionId && h.joinedAt > prev[1].joinedAt))
      newest.set(h.userId, [id, h]);
  }
  return [...newest.values()]
    .map(([sessionId, h]) => ({
      sessionId,
      userId: h.userId,
      name: h.displayName,
      place: placeAt(world, h.position.x, h.position.z),
      doing: doingLine(h),
      seated: h.seatId !== "",
      self: h.userId === selfUser,
    }))
    .sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
}

/** A string that changes exactly when the rows do (positions inside one place do not). */
export function rowsKey(rows: readonly WhereaboutsRow[]): string {
  return rows
    .map((r) => [r.sessionId, r.name, r.place.label, r.doing, r.seated ? 1 : 0].join("\u0001"))
    .join("\u0002");
}
