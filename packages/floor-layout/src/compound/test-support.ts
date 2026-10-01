/**
 * Test support for the compound's property tests: a seeded PRNG (so a
 * failure names the seed that reproduces it), random placements, and
 * independent brute-force checks of the invariants.
 */
import {
  CORRIDOR_WIDTH_TILES,
  DOOR_SIDES,
  ROOM_MAX_TILES,
  ROOM_MIN_GAP_TILES,
  ROOM_MIN_TILES,
  type RoomPlacement,
  type TileRect,
} from "@regulus/protocol";
import { doorFront, expandTileRect, tileRectsOverlap } from "./grid.ts";
import type { CompoundLayout, CompoundRoomInput } from "./layout.ts";
import { type CompoundSpec, mainCorridor } from "./special.ts";
import { checkPlacement } from "./validate.ts";

/** mulberry32: small, fast, good enough for test inputs. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (r: () => number, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1));

export function randomPlacement(r: () => number, spec: CompoundSpec): RoomPlacement {
  const width = int(r, ROOM_MIN_TILES, ROOM_MAX_TILES);
  const depth = int(r, ROOM_MIN_TILES, ROOM_MAX_TILES);
  return {
    gridX: int(r, 0, spec.width - width),
    gridY: int(r, 0, spec.depth - depth),
    width,
    depth,
    doorSide: DOOR_SIDES[int(r, 0, 3)] ?? "south",
  };
}

/** Place up to `count` random rooms, keeping only those `checkPlacement` accepts. */
export function randomCompound(
  seed: number,
  spec: CompoundSpec,
  count: number,
  attempts = count * 40,
): CompoundRoomInput[] {
  const r = rng(seed);
  const rooms: CompoundRoomInput[] = [];
  for (let i = 0; i < attempts && rooms.length < count; i++) {
    const id = `room-${seed}-${i}`;
    const placement = randomPlacement(r, spec);
    if (checkPlacement(spec, rooms, id, placement).ok) rooms.push({ id, placement });
  }
  return rooms;
}

export function shuffled<T>(items: readonly T[], r: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(r, 0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const isCorridor = (layout: CompoundLayout, x: number, y: number) =>
  x >= 0 && y >= 0 && x < layout.width && y < layout.depth
    ? layout.network.tiles[y * layout.width + x] === 1
    : false;

/**
 * Every invariant of an accepted layout, checked without the code under
 * test: rooms disjoint and spaced, corridors outside rooms and 2 wide,
 * every door's block on the corridor, all of it connected to the main corridor.
 */
export function layoutViolations(layout: CompoundLayout): string[] {
  const out: string[] = [];
  const all = [...layout.specialRooms, ...layout.rooms];
  for (const a of all) {
    if (a.rect.x < 0 || a.rect.y < 0) out.push(`${a.id} out of bounds`);
    if (a.rect.x + a.rect.w > layout.width || a.rect.y + a.rect.d > layout.depth)
      out.push(`${a.id} out of bounds`);
    if (tileRectsOverlap(a.rect, layout.mainCorridor)) out.push(`${a.id} on the main corridor`);
    for (const b of all) {
      if (a.id >= b.id) continue;
      if (tileRectsOverlap(a.rect, b.rect)) out.push(`${a.id} overlaps ${b.id}`);
      else if (tileRectsOverlap(expandTileRect(a.rect, ROOM_MIN_GAP_TILES), b.rect))
        out.push(`${a.id} too close to ${b.id}`);
    }
  }
  for (let y = 0; y < layout.depth; y++) {
    for (let x = 0; x < layout.width; x++) {
      if (!isCorridor(layout, x, y)) continue;
      const tile: TileRect = { x, y, w: 1, d: 1 };
      for (const room of all)
        if (tileRectsOverlap(tile, room.rect)) out.push(`corridor (${x},${y}) in ${room.id}`);
      if (!inFullBlock(layout, x, y)) out.push(`corridor (${x},${y}) narrower than 2`);
    }
  }
  const reached = floodCorridors(layout);
  for (const room of all) {
    const f = doorFront(room.rect, room.doorSide);
    for (let y = f.y; y < f.y + f.d; y++)
      for (let x = f.x; x < f.x + f.w; x++) {
        if (!isCorridor(layout, x, y)) out.push(`${room.id} door block (${x},${y}) not corridor`);
        else if (!reached.has(y * layout.width + x)) out.push(`${room.id} door cut off`);
      }
  }
  return out;
}

function inFullBlock(layout: CompoundLayout, x: number, y: number): boolean {
  const c = CORRIDOR_WIDTH_TILES;
  for (let oy = 0; oy < c; oy++)
    for (let ox = 0; ox < c; ox++) {
      let full = true;
      for (let dy = 0; dy < c && full; dy++)
        for (let dx = 0; dx < c && full; dx++) full = isCorridor(layout, x - ox + dx, y - oy + dy);
      if (full) return true;
    }
  return false;
}

function floodCorridors(layout: CompoundLayout): Set<number> {
  const root = mainCorridor(layout.spec);
  const seen = new Set<number>();
  const stack: Array<[number, number]> = [[root.x, root.y]];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    const k = y * layout.width + x;
    if (seen.has(k) || !isCorridor(layout, x, y)) continue;
    seen.add(k);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}
