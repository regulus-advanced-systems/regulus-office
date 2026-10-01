/**
 * Tile geometry for the compound (SPEC §9.1). Grid conventions are in
 * @regulus/protocol `compound.ts`: tile `(x, y)` covers world metres
 * `[2x, 2x+2) × [2y, 2y+2)`, `y` grows south. Rectangles are half-open:
 * `[x, x+w) × [y, y+d)`.
 */
import {
  COMPOUND_TILE_METRES,
  CORRIDOR_WIDTH_TILES,
  DOOR_WIDTH_TILES,
  type DoorSide,
  type RoomPlacement,
  type TileRect,
} from "@regulus/protocol";
import { DIRECTION, HEADING, type Pose } from "../geometry.ts";

export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** A room's footprint from its placement. */
export function placementRect(p: RoomPlacement): TileRect {
  return { x: p.gridX, y: p.gridY, w: p.width, d: p.depth };
}

/** True when two tile rectangles share at least one tile. */
export function tileRectsOverlap(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}

/** `r` grown by `n` tiles on every side (may go negative). */
export function expandTileRect(r: TileRect, n: number): TileRect {
  return { x: r.x - n, y: r.y - n, w: r.w + 2 * n, d: r.d + 2 * n };
}

/** True when `r` lies inside `[0, width) × [0, depth)`. */
export function tileRectInBounds(r: TileRect, width: number, depth: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.d <= depth;
}

/**
 * Grid point where a room's door segment starts. The door is centred on its
 * wall and runs east (north/south walls) or south (east/west walls).
 */
export function doorStart(rect: TileRect, side: DoorSide): TilePoint {
  const alongX = rect.x + Math.floor((rect.w - DOOR_WIDTH_TILES) / 2);
  const alongY = rect.y + Math.floor((rect.d - DOOR_WIDTH_TILES) / 2);
  switch (side) {
    case "north":
      return { x: alongX, y: rect.y };
    case "south":
      return { x: alongX, y: rect.y + rect.d };
    case "west":
      return { x: rect.x, y: alongY };
    case "east":
      return { x: rect.x + rect.w, y: alongY };
  }
}

/**
 * The corridor block just outside a door: {@link CORRIDOR_WIDTH_TILES} square,
 * where the room's corridor starts. Its top-left tile is the route's anchor.
 */
export function doorFront(rect: TileRect, side: DoorSide): TileRect {
  const s = doorStart(rect, side);
  const c = CORRIDOR_WIDTH_TILES;
  switch (side) {
    case "north":
      return { x: s.x, y: s.y - c, w: c, d: c };
    case "south":
      return { x: s.x, y: s.y, w: c, d: c };
    case "west":
      return { x: s.x - c, y: s.y, w: c, d: c };
    case "east":
      return { x: s.x, y: s.y, w: c, d: c };
  }
}

/**
 * Where to stand in front of a door, in world metres: centred on the door,
 * in the middle of the corridor block outside it, facing into the room (quick travel, SPEC §9.1).
 */
export function doorApproach(rect: TileRect, side: DoorSide): Pose {
  const s = doorStart(rect, side);
  const half = DOOR_WIDTH_TILES / 2;
  const out = DIRECTION[side];
  const along = side === "north" || side === "south" ? { x: half, z: 0 } : { x: 0, z: half };
  const inward: Record<DoorSide, DoorSide> = {
    north: "south",
    south: "north",
    east: "west",
    west: "east",
  };
  return {
    x: (s.x + along.x + out.x) * COMPOUND_TILE_METRES,
    z: (s.y + along.z + out.z) * COMPOUND_TILE_METRES,
    heading: HEADING[inward[side]],
  };
}

/**
 * Cover a set of tiles (`tiles[y * width + x] === 1`) with disjoint
 * rectangles: horizontal runs, merged downward while the run repeats.
 * Deterministic, row-major.
 */
export function tilesToRects(tiles: Uint8Array, width: number, depth: number): TileRect[] {
  const open = new Map<string, { x: number; y: number; w: number; d: number }>();
  const done: TileRect[] = [];
  for (let y = 0; y < depth; y++) {
    const runs: Array<[number, number]> = [];
    for (let x = 0; x < width; x++) {
      if (tiles[y * width + x] !== 1) continue;
      const start = x;
      while (x + 1 < width && tiles[y * width + x + 1] === 1) x++;
      runs.push([start, x - start + 1]);
    }
    const next = new Map<string, { x: number; y: number; w: number; d: number }>();
    for (const [x, w] of runs) {
      const key = `${x}:${w}`;
      const rect = open.get(key);
      if (rect) {
        rect.d++;
        open.delete(key);
        next.set(key, rect);
      } else {
        next.set(key, { x, y, w, d: 1 });
      }
    }
    for (const rect of open.values()) done.push(rect);
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  for (const rect of open.values()) done.push(rect);
  return done.sort((a, b) => a.y - b.y || a.x - b.x);
}
