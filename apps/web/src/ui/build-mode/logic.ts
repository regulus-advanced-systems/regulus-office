/**
 * Build mode's pure rules (SPEC §9.1, D8, D21; #187): room size presets,
 * snapping the ghost to the grid under the cursor, nudging it with the
 * arrow keys relative to the camera, turning the door, a first spot to
 * offer, the instant local check and how a refusal reads. The server's
 * `POST /api/compound/check` has the final word; the local check only
 * colours the ghost until its answer is in.
 */

import {
  DOOR_SIDES,
  type DoorSide,
  type PlacementError,
  ROOM_MAX_TILES,
  ROOM_MIN_TILES,
  type RoomPlacement,
  type TileRect,
} from "@regulus/protocol";
import {
  type CompoundSpec,
  checkPlacement,
  findPlacement,
  MAIN_CORRIDOR_ID,
  rowSlot,
  tilesToRects,
} from "@regulus/room-layout";
import {
  builtBounds,
  type CompoundWorld,
  lobbyOf,
  type WorldRoom,
} from "../../scene/compound/world.ts";
import { screenAxes } from "../../scene/movement/wasd.ts";

export interface RoomSize {
  w: number;
  d: number;
}

export type SizePreset = "S" | "M" | "L";

/** The presets; anything else from 4 to 12 tiles a side is "custom". */
export const SIZE_PRESETS: Readonly<Record<SizePreset, RoomSize & { label: string }>> = {
  S: { w: 6, d: 6, label: "Small" },
  M: { w: 8, d: 8, label: "Medium" },
  L: { w: 10, d: 10, label: "Large" },
};

export const DEFAULT_PRESET: SizePreset = "M";

export function presetOf(size: RoomSize): SizePreset | "custom" {
  for (const [id, p] of Object.entries(SIZE_PRESETS) as [SizePreset, RoomSize][])
    if (p.w === size.w && p.d === size.d) return id;
  return "custom";
}

/** A side length clamped to what a room may be (whole tiles, 4..12). */
export function clampSide(n: number): number {
  if (!Number.isFinite(n)) return ROOM_MIN_TILES;
  return Math.min(ROOM_MAX_TILES, Math.max(ROOM_MIN_TILES, Math.round(n)));
}

export interface TilePos {
  x: number;
  y: number;
}

/** Keep a room of `size` on the compound grid (the ghost never leaves it). */
export function clampGhost(world: CompoundWorld, pos: TilePos, size: RoomSize): TilePos {
  return {
    x: Math.min(Math.max(0, pos.x), Math.max(0, world.width - size.w)),
    y: Math.min(Math.max(0, pos.y), Math.max(0, world.depth - size.d)),
  };
}

/** The ghost's north-west tile with its middle under the cursor (metres). */
export function ghostAt(
  world: CompoundWorld,
  cursor: { x: number; z: number },
  size: RoomSize,
): TilePos {
  const m = world.tileMetres;
  return clampGhost(
    world,
    { x: Math.round(cursor.x / m - size.w / 2), y: Math.round(cursor.z / m - size.d / 2) },
    size,
  );
}

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** One tile step on the grid; up-screen snapped to the nearest grid direction for this camera yaw. */
export function arrowStep(key: ArrowKey, yawRad: number): TilePos {
  const { forward } = screenAxes((yawRad * 180) / Math.PI);
  // Quarter turns clockwise (seen from above) from up-screen.
  const turns = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }[key];
  const angle = Math.atan2(forward.z, forward.x) + (turns * Math.PI) / 2;
  // Snap with a small bias so a 45° camera always picks the same neighbour.
  const q = Math.round((angle + 1e-6) / (Math.PI / 2));
  const x = Math.round(Math.cos((q * Math.PI) / 2));
  const y = Math.round(Math.sin((q * Math.PI) / 2));
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** R turns the door clockwise (seen from above); Shift+R back. */
export function rotateDoor(side: DoorSide, dir: 1 | -1 = 1): DoorSide {
  const order: DoorSide[] = ["north", "east", "south", "west"];
  const i = order.indexOf(side);
  return order[(i + dir + order.length) % order.length] ?? "south";
}

export const DOOR_SIDE_LABELS: Readonly<Record<DoorSide, string>> = {
  north: "North",
  east: "East",
  south: "South",
  west: "West",
};

export { DOOR_SIDES };

export function placementOf(pos: TilePos, size: RoomSize, doorSide: DoorSide): RoomPlacement {
  return { gridX: pos.x, gridY: pos.y, width: size.w, depth: size.d, doorSide };
}

export function placementKey(p: RoomPlacement): string {
  return `${p.gridX},${p.gridY},${p.width}x${p.depth},${p.doorSide}`;
}

/** The compound's spec as the client can rebuild it from the published layout. */
export function specOf(world: CompoundWorld): CompoundSpec | null {
  const lobby = lobbyOf(world);
  return lobby ? { width: world.width, depth: world.depth, lobby: lobby.rect } : null;
}

/** Project rooms as placements, leaving out `skip` (the room being moved). */
export function placedRooms(
  world: CompoundWorld,
  skip?: string,
): { id: string; placement: RoomPlacement }[] {
  return world.rooms
    .filter((r) => r.kind === "project" && r.id !== skip)
    .map((r) => ({ id: r.id, placement: placementOf(r.rect, r.rect, r.doorSide) }));
}

export interface LocalCheck {
  ok: boolean;
  reason?: PlacementError;
  conflicts: string[];
  /** Corridor the room would add (tile rects), for the preview; empty when refused. */
  corridor: TileRect[];
}

/** Tiles of `next` not already in `current`, as rects. */
export function newCorridorTiles(
  width: number,
  depth: number,
  current: readonly TileRect[],
  next: readonly TileRect[],
): TileRect[] {
  const mask = new Uint8Array(width * depth);
  const paint = (rects: readonly TileRect[], v: number) => {
    for (const r of rects)
      for (let y = r.y; y < r.y + r.d && y < depth; y++)
        for (let x = r.x; x < r.x + r.w && x < width; x++) mask[y * width + x] = v;
  };
  paint(next, 1);
  paint(current, 0);
  return tilesToRects(mask, width, depth);
}

/** The same rules the server runs, for an instant colour and the corridor preview. */
export function localCheck(
  world: CompoundWorld,
  placement: RoomPlacement,
  skip?: string,
): LocalCheck {
  const spec = specOf(world);
  if (!spec) return { ok: false, reason: "out_of_bounds", conflicts: [], corridor: [] };
  const r = checkPlacement(spec, placedRooms(world, skip), skip ?? "ghost", placement);
  if (!r.ok) return { ok: false, reason: r.reason, conflicts: [...r.conflicts], corridor: [] };
  return {
    ok: true,
    conflicts: [],
    corridor: newCorridorTiles(world.width, world.depth, world.corridors, r.layout.corridors),
  };
}

/** Where the ghost first appears for a new room: the next free row slot, or the nearest valid spot. */
export function suggestSpot(world: CompoundWorld, size: RoomSize): TilePos | null {
  const spec = specOf(world);
  if (!spec) return null;
  const others = placedRooms(world);
  const wanted = { width: size.w, depth: size.d };
  const p = rowSlot(spec, others, "ghost", wanted) ?? findPlacement(spec, others, "ghost", wanted);
  return p ? { x: p.gridX, y: p.gridY } : null;
}

/** A room id from a refusal as people say it. */
export function conflictName(world: CompoundWorld, id: string): string {
  if (id === MAIN_CORRIDOR_ID) return "the main corridor";
  const room: WorldRoom | undefined = world.rooms.find((r) => r.id === id || r.kind === id);
  if (!room) return "another room";
  return room.kind === "project" ? room.name : `the ${room.name.toLowerCase()}`;
}

function names(world: CompoundWorld, ids: readonly string[]): string {
  const list = [...new Set(ids.map((id) => conflictName(world, id)))];
  if (list.length === 0) return "";
  if (list.length === 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Why the ghost is red, in words. */
export function describeRefusal(
  world: CompoundWorld,
  reason: PlacementError | undefined,
  conflicts: readonly string[],
): string {
  const who = names(world, conflicts);
  switch (reason) {
    case "bad_size":
      return `Rooms are ${ROOM_MIN_TILES} to ${ROOM_MAX_TILES} tiles a side.`;
    case "out_of_bounds":
      return "That is outside the compound.";
    case "overlap":
      return who ? `It overlaps ${who}.` : "It overlaps another room.";
    case "too_close":
      return `Too close to ${who || "another room"}: keep 2 tiles clear for a corridor.`;
    case "door_blocked":
      return who
        ? `The door opens onto ${who}. Turn it (R) or move the room.`
        : "The door opens onto rock at the edge. Turn it (R) or move the room.";
    case "unreachable":
      return "No corridor can reach that door from the lobby.";
    case "blocks_room":
      return `It would cut ${who || "another room"} off from the lobby.`;
    default:
      return "That spot is not free.";
  }
}

/** Extra tiles around the built compound that the build-mode overview shows. */
export const BUILD_FRAME_MARGIN_TILES = 8;

/** What the camera frames while placing: the built compound plus room around it to build in. */
export function buildFrame(world: CompoundWorld): {
  centre: { x: number; z: number };
  extent: number;
} {
  const built = builtBounds(world);
  const m = world.tileMetres;
  const extent = Math.min(
    built.extent + 2 * BUILD_FRAME_MARGIN_TILES * m,
    Math.max(world.width, world.depth) * m,
  );
  return { centre: built.centre, extent };
}

let memo: { key: string; value: LocalCheck } | null = null;

/** `localCheck`, remembered for the last spot (the panel and the scene both ask). */
export function cachedLocalCheck(
  world: CompoundWorld,
  placement: RoomPlacement,
  skip?: string,
): LocalCheck {
  const key = `${world.version}|${skip ?? ""}|${placementKey(placement)}`;
  if (memo?.key === key) return memo.value;
  const value = localCheck(world, placement, skip);
  memo = { key, value };
  return value;
}
