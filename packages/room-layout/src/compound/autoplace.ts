/**
 * Finding room placements automatically: rooms created without a placement
 * (the pre-compound operation API), operations migrated from the building of operations
 * (SPEC §9.1 "placed in a row off the main corridor"), and archived rooms
 * restored onto a spot that has since been built over.
 */
import {
  type DoorSide,
  MAX_COMPOUND_SIZE_TILES,
  ROOM_MAX_TILES,
  ROOM_MIN_GAP_TILES,
  type RoomPlacement,
} from "@regulus/protocol";
import { doorFront, expandTileRect, placementRect, tileRectsOverlap } from "./grid.ts";
import type { CompoundRoomInput } from "./layout.ts";
import {
  type CompoundSpec,
  defaultCompoundSpec,
  landingSpec,
  MAIN_CORRIDOR_MARGIN_TILES,
  mainCorridor,
  specialRooms,
} from "./special.ts";
import { checkPlacement, checkPlacementGeometry } from "./validate.ts";

export interface RoomSize {
  readonly width: number;
  readonly depth: number;
}

/** Clear space auto-placement leaves between rooms when it can ("spacious", SPEC §12). */
export const PREFERRED_GAP_TILES = 4;
/** Rows of migrated rooms are this far apart (north to south, bottom to bottom). */
export const ROW_PITCH_TILES = ROOM_MAX_TILES + PREFERRED_GAP_TILES;
/** How much a compound grows (each side) when migrated operations do not fit. */
export const GROWTH_STEP_TILES = 16;

/** Size for an operation migrated from a fixed template, from how many desk seats it has. */
export function legacyRoomSize(deskSeats: number): RoomSize {
  if (deskSeats <= 8) return { width: 8, depth: 8 };
  if (deskSeats <= 12) return { width: 10, depth: 10 };
  return { width: 12, depth: 12 };
}

/**
 * True when `candidate` passes every rule and, with `gap` above the minimum,
 * also keeps that much space from other project rooms (special rooms sit
 * just across the main corridor, so they only get the minimum).
 */
function fits(
  spec: CompoundSpec,
  placed: readonly CompoundRoomInput[],
  id: string,
  candidate: RoomPlacement,
  gap: number,
): boolean {
  if (checkPlacementGeometry(spec, placed, candidate)) return false;
  if (gap > ROOM_MIN_GAP_TILES) {
    const halo = expandTileRect(placementRect(candidate), gap);
    if (placed.some((p) => tileRectsOverlap(halo, placementRect(p.placement)))) return false;
  }
  return checkPlacement(spec, placed, id, candidate).ok;
}

/**
 * The slot for `id` in the rows north of the main corridor: doors face
 * south; rows fill from the middle outward, nearest row first.
 */
export function rowSlot(
  spec: CompoundSpec,
  placed: readonly CompoundRoomInput[],
  id: string,
  size: RoomSize,
): RoomPlacement | null {
  const firstBottom = mainCorridor(spec).y;
  const minX = MAIN_CORRIDOR_MARGIN_TILES;
  const maxX = spec.width - MAIN_CORRIDOR_MARGIN_TILES - size.width;
  const mid = spec.width / 2;
  const xs: number[] = [];
  for (let x = minX; x <= maxX; x++) xs.push(x);
  xs.sort(
    (a, b) => Math.abs(a + size.width / 2 - mid) - Math.abs(b + size.width / 2 - mid) || a - b,
  );
  for (let bottom = firstBottom; bottom - size.depth >= 0; bottom -= ROW_PITCH_TILES) {
    for (const x of xs) {
      const candidate: RoomPlacement = {
        gridX: x,
        gridY: bottom - size.depth,
        width: size.width,
        depth: size.depth,
        doorSide: "south",
      };
      if (fits(spec, placed, id, candidate, PREFERRED_GAP_TILES)) return candidate;
    }
  }
  return null;
}

/**
 * Any valid spot for a room of `size`, nearest the lobby first (by the
 * corridor block outside the door), preferring the roomier gap. Door sides
 * are tried in `sides` order on ties.
 */
export function findPlacement(
  spec: CompoundSpec,
  placed: readonly CompoundRoomInput[],
  id: string,
  size: RoomSize,
  sides: readonly DoorSide[] = ["south", "north", "east", "west"],
): RoomPlacement | null {
  const lobby = specialRooms(spec)[0];
  if (!lobby) return null;
  const target = doorFront(lobby.rect, lobby.doorSide);
  const candidates: Array<{ p: RoomPlacement; score: number }> = [];
  for (let y = 0; y + size.depth <= spec.depth; y++) {
    for (let x = 0; x + size.width <= spec.width; x++) {
      sides.forEach((doorSide, rank) => {
        const p: RoomPlacement = { gridX: x, gridY: y, ...size, doorSide };
        const f = doorFront({ x, y, w: size.width, d: size.depth }, doorSide);
        const score = (Math.abs(f.x - target.x) + Math.abs(f.y - target.y)) * 4 + rank;
        candidates.push({ p, score });
      });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.p.gridY - b.p.gridY || a.p.gridX - b.p.gridX);
  for (const gap of [PREFERRED_GAP_TILES, ROOM_MIN_GAP_TILES]) {
    for (const { p } of candidates) if (fits(spec, placed, id, p, gap)) return p;
  }
  return null;
}

export interface ReconcileInput {
  readonly id: string;
  /** Its stored placement, or null when it was never placed. */
  readonly placement: RoomPlacement | null;
  /** Size (and door side) to use when it has to be placed anew. */
  readonly size: RoomSize;
}

export interface ReconcileResult {
  readonly placements: ReadonlyMap<string, RoomPlacement>;
  /** Rooms given a new placement (never placed, or their spot was invalid). */
  readonly changed: readonly string[];
  /** Rooms for which no spot was found. */
  readonly unplaced: readonly string[];
}

/**
 * Make a set of rooms valid, in priority order (earlier rooms keep their
 * spot first). Valid placements are kept; the others are placed anew in
 * the rows off the main corridor, else anywhere that fits.
 *
 * With `stopAtUnplaced`, gives up at the first room with no spot (every
 * later pending room is reported unplaced too): a failed search scans the
 * whole compound, so a caller that only needs "do they all fit" should not
 * pay for it once per remaining room.
 */
export function reconcilePlacements(
  spec: CompoundSpec,
  rooms: readonly ReconcileInput[],
  { stopAtUnplaced = false }: { stopAtUnplaced?: boolean } = {},
): ReconcileResult {
  const placed: CompoundRoomInput[] = [];
  const pending: ReconcileInput[] = [];
  for (const room of rooms) {
    if (room.placement && checkPlacement(spec, placed, room.id, room.placement).ok) {
      placed.push({ id: room.id, placement: room.placement });
    } else {
      pending.push(room);
    }
  }
  const changed: string[] = [];
  const unplaced: string[] = [];
  for (const [i, room] of pending.entries()) {
    if (stopAtUnplaced && unplaced.length > 0) {
      unplaced.push(...pending.slice(i).map((r) => r.id));
      break;
    }
    const spot =
      rowSlot(spec, placed, room.id, room.size) ?? findPlacement(spec, placed, room.id, room.size);
    if (spot) {
      placed.push({ id: room.id, placement: spot });
      changed.push(room.id);
    } else {
      unplaced.push(room.id);
    }
  }
  return { placements: new Map(placed.map((p) => [p.id, p.placement])), changed, unplaced };
}

/**
 * Migrating the building of operations: lay every room out in rows off the main
 * corridor. When they do not fit the compound grows (lobby re-centred on the
 * south edge), up to the maximum size; only valid while nothing is placed yet.
 * Sizes that turn out too small are abandoned at the first room that does
 * not fit; only the final size is laid out in full.
 */
export function planMigration(
  spec: CompoundSpec,
  rooms: readonly ReconcileInput[],
): { spec: CompoundSpec; result: ReconcileResult } {
  let current = spec;
  for (;;) {
    const width = Math.min(MAX_COMPOUND_SIZE_TILES, current.width + GROWTH_STEP_TILES);
    const depth = Math.min(MAX_COMPOUND_SIZE_TILES, current.depth + GROWTH_STEP_TILES);
    const largest = width === current.width && depth === current.depth;
    // At the largest size, place what fits and report the rest.
    const result = reconcilePlacements(current, rooms, { stopAtUnplaced: !largest });
    if (result.unplaced.length === 0 || largest) return { spec: current, result };
    const grown = defaultCompoundSpec(width, depth);
    current = spec.landing ? landingSpec(grown) : grown;
  }
}
