/**
 * Building blocks reused by the templates: the four perimeter walls and the
 * furniture groups GDT's offices are built from (research 03 §3-4). Sizes are
 * plausible metric furniture, not measurements from the game.
 */
import { HEADING } from "../geometry.ts";
import type { Obstacle, Seat, Wall, WallOpening } from "../types.ts";

/** Standard window width, metres. */
export const WINDOW_W = 1.2;

export function windows(starts: readonly number[], w = WINDOW_W): WallOpening[] {
  return starts.map((t) => ({ kind: "window" as const, t, w }));
}

export interface PerimeterOpenings {
  north?: WallOpening[];
  west?: WallOpening[];
}

/**
 * Dollhouse room: north and west are full back walls, south and east are
 * front stubs. Walls run clockwise-agnostic; `facing` points into the room.
 */
export function perimeter(width: number, depth: number, openings: PerimeterOpenings = {}): Wall[] {
  return [
    {
      id: "north",
      from: { x: 0, z: 0 },
      to: { x: width, z: 0 },
      height: "full",
      facing: "south",
      openings: openings.north ?? [],
    },
    {
      id: "west",
      from: { x: 0, z: 0 },
      to: { x: 0, z: depth },
      height: "full",
      facing: "east",
      openings: openings.west ?? [],
    },
    {
      id: "south",
      from: { x: 0, z: depth },
      to: { x: width, z: depth },
      height: "stub",
      facing: "north",
      openings: [],
    },
    {
      id: "east",
      from: { x: width, z: 0 },
      to: { x: width, z: depth },
      height: "stub",
      facing: "west",
      openings: [],
    },
  ];
}

export interface Group {
  obstacles: Obstacle[];
  seats: Seat[];
}

/** Thick slab desk 1.6 x 0.8 with one chair on its south side. */
export function soloDesk(id: string, seatX: number, deskZ: number): Group {
  return {
    obstacles: [{ id, kind: "desk", rect: { x: seatX - 0.8, z: deskZ, w: 1.6, d: 0.8 } }],
    seats: [
      {
        id: `${id}-seat`,
        kind: "desk",
        furnitureId: id,
        pose: { x: seatX, z: deskZ + 1.25, heading: HEADING.north },
      },
    ],
  };
}

/** Big shared table 3.2 x 1.6 with two chairs per long side (four workstations). */
export function sharedTable(id: string, x: number, z: number): Group {
  const seat = (suffix: string, sx: number, sz: number, heading: number): Seat => ({
    id: `${id}-${suffix}`,
    kind: "desk",
    furnitureId: id,
    pose: { x: sx, z: sz, heading },
  });
  return {
    obstacles: [{ id, kind: "shared_table", rect: { x, z, w: 3.2, d: 1.6 } }],
    seats: [
      seat("n1", x + 0.75, z - 0.5, HEADING.south),
      seat("n2", x + 2.25, z - 0.5, HEADING.south),
      seat("s1", x + 0.75, z + 2.0, HEADING.north),
      seat("s2", x + 2.25, z + 2.0, HEADING.north),
    ],
  };
}

/** L-shaped CEO desk: 2.4 m main slab with a 1.6 m return on the east end; chair inside the L. */
export function ceoDesk(id: string, x: number, z: number): Group {
  return {
    obstacles: [
      { id: `${id}-main`, kind: "ceo_desk", rect: { x, z, w: 2.4, d: 0.8 } },
      { id: `${id}-return`, kind: "ceo_desk", rect: { x: x + 1.6, z: z + 0.8, w: 0.8, d: 1.6 } },
    ],
    seats: [
      {
        id: `${id}-seat`,
        kind: "desk",
        furnitureId: `${id}-main`,
        pose: { x: x + 0.75, z: z + 1.25, heading: HEADING.north },
      },
    ],
  };
}

export function plant(id: string, x: number, z: number): Obstacle {
  return { id, kind: "plant", rect: { x, z, w: 0.5, d: 0.5 } };
}

export function cabinets(id: string, x: number, z: number, w: number, d: number): Obstacle {
  return { id, kind: "cabinet", rect: { x, z, w, d } };
}

/** Merge furniture groups and loose obstacles into flat seat / obstacle lists. */
export function furnish(groups: Group[], extra: Obstacle[] = []): Group {
  return {
    obstacles: [...groups.flatMap((g) => g.obstacles), ...extra],
    seats: groups.flatMap((g) => g.seats),
  };
}
