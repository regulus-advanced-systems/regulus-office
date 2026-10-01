/**
 * Placement rules for project rooms (SPEC §9.1): in bounds, sized 4..12
 * tiles a side, not overlapping anything, at least the minimum gap from
 * every other room, a free corridor block outside the door, and a corridor
 * route to the lobby that does not cut any other room off.
 */
import {
  DOOR_SIDES,
  type PlacementError,
  ROOM_MAX_TILES,
  ROOM_MIN_GAP_TILES,
  ROOM_MIN_TILES,
  type RoomPlacement,
  type TileRect,
} from "@regulus/protocol";
import {
  doorFront,
  expandTileRect,
  placementRect,
  tileRectInBounds,
  tileRectsOverlap,
} from "./grid.ts";
import { type CompoundLayout, type CompoundRoomInput, computeCompoundLayout } from "./layout.ts";
import { type CompoundSpec, mainCorridor, specialRooms } from "./special.ts";

export const MAIN_CORRIDOR_ID = "main_corridor";

export type PlacementCheck =
  | { readonly ok: true; readonly layout: CompoundLayout }
  | { readonly ok: false; readonly reason: PlacementError; readonly conflicts: readonly string[] };

const refuse = (reason: PlacementError, conflicts: string[] = []): PlacementCheck => ({
  ok: false,
  reason,
  conflicts: [...new Set(conflicts)].sort(),
});

const span = (n: number) => Number.isInteger(n) && n >= ROOM_MIN_TILES && n <= ROOM_MAX_TILES;

/** Room shape alone: integer grid position, 4..12 tiles a side, a known door side. */
export function placementShapeOk(p: RoomPlacement): boolean {
  return (
    Number.isInteger(p.gridX) &&
    Number.isInteger(p.gridY) &&
    span(p.width) &&
    span(p.depth) &&
    (DOOR_SIDES as readonly string[]).includes(p.doorSide)
  );
}

/**
 * The cheap checks (everything but routing) of `candidate` against the
 * special rooms, the main corridor and `others` (which must not contain it).
 */
export function checkPlacementGeometry(
  spec: CompoundSpec,
  others: readonly CompoundRoomInput[],
  candidate: RoomPlacement,
  gap: number = ROOM_MIN_GAP_TILES,
): PlacementCheck | null {
  if (!placementShapeOk(candidate)) return refuse("bad_size");
  const rect = placementRect(candidate);
  if (!tileRectInBounds(rect, spec.width, spec.depth)) return refuse("out_of_bounds");

  const obstacles: Array<{ id: string; rect: TileRect }> = [
    ...specialRooms(spec).map((s) => ({ id: s.kind, rect: s.rect })),
    ...others.map((o) => ({ id: o.id, rect: placementRect(o.placement) })),
  ];
  const corridor = mainCorridor(spec);
  const overlaps = obstacles.filter((o) => tileRectsOverlap(rect, o.rect)).map((o) => o.id);
  if (tileRectsOverlap(rect, corridor)) overlaps.push(MAIN_CORRIDOR_ID);
  if (overlaps.length > 0) return refuse("overlap", overlaps);

  const halo = expandTileRect(rect, gap);
  const near = obstacles.filter((o) => tileRectsOverlap(halo, o.rect)).map((o) => o.id);
  if (near.length > 0) return refuse("too_close", near);

  const front = doorFront(rect, candidate.doorSide);
  if (!tileRectInBounds(front, spec.width, spec.depth)) return refuse("door_blocked");
  const blocking = obstacles.filter((o) => tileRectsOverlap(front, o.rect)).map((o) => o.id);
  if (blocking.length > 0) return refuse("door_blocked", blocking);
  return null;
}

/**
 * Full check of placing (or moving) room `id` at `candidate` among `rooms`.
 * `rooms` may contain `id` (its old placement is ignored). On success the
 * resulting layout is returned so callers need not recompute it.
 */
export function checkPlacement(
  spec: CompoundSpec,
  rooms: readonly CompoundRoomInput[],
  id: string,
  candidate: RoomPlacement,
): PlacementCheck {
  const others = rooms.filter((r) => r.id !== id);
  const geometry = checkPlacementGeometry(spec, others, candidate);
  if (geometry) return geometry;
  const layout = computeCompoundLayout(spec, [...others, { id, placement: candidate }]);
  if (layout.unreachable.includes(id)) return refuse("unreachable");
  if (layout.unreachable.length > 0) {
    const before = new Set(computeCompoundLayout(spec, others).unreachable);
    const cut = layout.unreachable.filter((r) => !before.has(r));
    if (cut.length > 0) return refuse("blocks_room", cut);
  }
  return { ok: true, layout };
}

/**
 * Every rule over a whole set of rooms: each room is checked against the
 * others and every room has a corridor. Empty when the compound is valid.
 */
export function layoutProblems(
  spec: CompoundSpec,
  rooms: readonly CompoundRoomInput[],
): Array<{ id: string; reason: PlacementError; conflicts: readonly string[] }> {
  const problems: Array<{ id: string; reason: PlacementError; conflicts: readonly string[] }> = [];
  for (const room of rooms) {
    const others = rooms.filter((r) => r.id !== room.id);
    const bad = checkPlacementGeometry(spec, others, room.placement);
    if (bad && !bad.ok)
      problems.push({ id: room.id, reason: bad.reason, conflicts: bad.conflicts });
  }
  for (const id of computeCompoundLayout(spec, rooms).unreachable) {
    problems.push({ id, reason: "unreachable", conflicts: [] });
  }
  return problems;
}
