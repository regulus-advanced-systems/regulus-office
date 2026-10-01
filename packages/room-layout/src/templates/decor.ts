/**
 * "Lived-in" building blocks (#118 review): plant groupings, lounge nooks,
 * floor-material patches, planters and small props on furniture. Plain data
 * helpers like `shared.ts`; the scene decides how each kind looks.
 */
import { HEADING } from "../geometry.ts";
import type { Decor, DecorKind, Obstacle, Rug, RugTone, Seat, WallDecor } from "../types.ts";
import { BIG_PLANT, type Group, plant } from "./shared.ts";

/** Pot footprints for the three plant sizes, metres. */
export const MID_PLANT = 0.6;
export const SMALL_PLANT = 0.4;

/** Flush floor-material zone (wood under a kitchen, a lighter tone under a lounge). */
export function patch(
  id: string,
  x: number,
  z: number,
  w: number,
  d: number,
  tone: RugTone = "wood",
): Rug {
  return { id, rect: { x, z, w, d }, tone, style: "patch" };
}

/**
 * Three plants of different sizes grouped in a corner or along a wall: a big
 * one at (x, z), a mid one beside it along x and a small pot in front of it
 * along z (or beside the mid one with `row`). `sx` / `sz` (+1 or -1) say which way the group grows from (x, z).
 */
export function plantGroup(
  id: string,
  x: number,
  z: number,
  sx: 1 | -1,
  sz: 1 | -1,
  /** Line all three up along x (against a wall) instead of putting the small pot in front. */
  row = false,
): Obstacle[] {
  const at = (ox: number, oz: number, size: number) => ({
    x: sx > 0 ? x + ox : x - ox - size,
    z: sz > 0 ? z + oz : z - oz - size,
  });
  const big = at(0, 0, BIG_PLANT);
  const mid = at(BIG_PLANT + 0.1, 0.1, MID_PLANT);
  const small = row
    ? at(BIG_PLANT + MID_PLANT + 0.2, 0.2, SMALL_PLANT)
    : at(0.2, BIG_PLANT + 0.1, SMALL_PLANT);
  return [
    plant(`${id}-big`, big.x, big.z, BIG_PLANT),
    plant(`${id}-mid`, mid.x, mid.z, MID_PLANT),
    { id: `${id}-small`, kind: "plant_small", rect: { ...small, w: SMALL_PLANT, d: SMALL_PLANT } },
  ];
}

export function smallPlant(id: string, x: number, z: number): Obstacle {
  return { id, kind: "plant_small", rect: { x, z, w: SMALL_PLANT, d: SMALL_PLANT } };
}

/**
 * Armchair whose cushion is a seat (kind `couch`, so no desk chair is drawn)
 * at (x, z) facing `heading`; only the backrest behind it blocks navigation.
 */
export function armchair(id: string, x: number, z: number, heading: number): Group {
  const back = 0.25;
  const w = 0.7;
  const rect =
    heading === HEADING.east
      ? { x: x - 0.5, z: z - w / 2, w: back, d: w }
      : heading === HEADING.west
        ? { x: x + 0.25, z: z - w / 2, w: back, d: w }
        : heading === HEADING.south
          ? { x: x - w / 2, z: z - 0.5, w, d: back }
          : { x: x - w / 2, z: z + 0.25, w, d: back };
  return {
    obstacles: [{ id, kind: "armchair", rect }],
    seats: [{ id: `${id}-seat`, kind: "couch", furnitureId: id, pose: { x, z, heading } }],
  };
}

/** Two armchairs facing each other across a coffee table, with a floor lamp beside them. */
export function loungeNook(id: string, x: number, z: number): Group {
  const west = armchair(`${id}-chair-w`, x, z, HEADING.east);
  const east = armchair(`${id}-chair-e`, x + 2, z, HEADING.west);
  const extra: Obstacle[] = [
    { id: `${id}-table`, kind: "coffee_table", rect: { x: x + 0.6, z: z - 0.35, w: 0.8, d: 0.6 } },
    { id: `${id}-lamp`, kind: "floor_lamp", rect: { x: x + 2.4, z: z + 0.65, w: 0.35, d: 0.35 } },
  ];
  return {
    obstacles: [...west.obstacles, ...east.obstacles, ...extra],
    seats: [...west.seats, ...east.seats],
  };
}

export function bookshelf(id: string, x: number, z: number, w = 1.4, d = 0.45): Obstacle {
  return { id, kind: "bookshelf", rect: { x, z, w, d } };
}

export function floorLamp(id: string, x: number, z: number): Obstacle {
  return { id, kind: "floor_lamp", rect: { x, z, w: 0.35, d: 0.35 } };
}

/** Planter box with small plants in it (a soft divider). */
export function planter(id: string, x: number, z: number, w: number, d: number): Obstacle {
  return { id, kind: "planter", rect: { x, z, w, d } };
}

export function bench(id: string, x: number, z: number, w = 1.2, d = 0.45): Obstacle {
  return { id, kind: "bench", rect: { x, z, w, d } };
}

export function prop(id: string, kind: DecorKind, on: string, x: number, z: number): Decor {
  return { id, kind, on, x, z, heading: 0 };
}

/** A small plant on the back-left corner of a `soloDesk(id, seatX, deskZ)`. */
export function deskPlant(deskId: string, seatX: number, deskZ: number): Decor {
  return prop(`${deskId}-plant`, "desk_plant", deskId, seatX - 0.55, deskZ + 0.2);
}

/** Mugs and a fruit bowl on a bistro table whose rect starts at (x, z). */
export function bistroProps(tableId: string, x: number, z: number): Decor[] {
  return [
    prop(`${tableId}-mugs`, "mugs", tableId, x + 0.25, z + 0.3),
    prop(`${tableId}-fruit`, "fruit_bowl", tableId, x + 0.5, z + 0.5),
  ];
}

export function wallDecor(
  id: string,
  kind: WallDecor["kind"],
  wallId: string,
  t: number,
  y: number,
  w: number,
  h: number,
): WallDecor {
  return { id, kind, wallId, t, y, w, h };
}

/** Flatten nook-style groups next to `furnish`. */
export function seatsOf(...groups: Group[]): Seat[] {
  return groups.flatMap((g) => g.seats);
}
