/**
 * The debug scene's content (#183): a furnished henchman ops room with a
 * break nook, the corridor junction outside its door (straight, cross, tee
 * and corner cells), a room under construction, and a catalogue apron with
 * one of every piece. Pure data, so the budget tests can cost it.
 */
import { HEADING } from "@regulus/floor-layout";
import { corridorCell, type RoomShell, roomShell } from "../assembly.ts";
import type { LairModelItem } from "../components/LairModels.tsx";
import { CORRIDOR_WIDTH, TILE, WALL_THICKNESS } from "../dimensions.ts";
import { PIECE_IDS, type PieceId } from "../kit.ts";
import type { PiecePlacement } from "../placements.ts";

const T = WALL_THICKNESS;

/** The ops room: 8 x 6 tiles (16 x 12 m) at the origin, door on the south wall. */
export const ROOM = { w: 8, d: 6, doorTile: 3 } as const;

export function sampleRoomShell(): RoomShell {
  return roomShell({
    w: ROOM.w,
    d: ROOM.d,
    door: { side: "south", tile: ROOM.doorTile },
    finish: { north: "wall_rock", west: "wall_concrete", east: "wall_rock", south: "wall_steel" },
    services: ["north", "west"],
    lampEvery: 2,
    beams: [5.8],
  });
}

const r = (x: number, z: number, w: number, d: number) => ({ x, z, w, d });

/** Furniture by generator model id, as #182 would emit it. */
export const SAMPLE_FURNITURE: readonly LairModelItem[] = [
  // Two pod desks in the middle with wide lanes.
  { id: "desk", rect: r(4.2, 4.6, 1.6, 1.2), heading: HEADING.south },
  { id: "desk", rect: r(8.2, 4.6, 1.6, 1.2), heading: HEADING.south },
  // The console bank along the north wall, mainframes on the west.
  { id: "console", rect: r(3.0, 0.3, 1.8, 0.95), heading: HEADING.south },
  { id: "console", rect: r(5.0, 0.3, 1.8, 0.95), heading: HEADING.south },
  { id: "console", rect: r(9.4, 0.3, 1.8, 0.95), heading: HEADING.south },
  { id: "mainframe", rect: r(0.25, 2.2, 0.8, 1.34), heading: HEADING.east },
  { id: "mainframe", rect: r(0.25, 3.8, 0.8, 1.34), heading: HEADING.east },
  { id: "bookshelf", rect: r(0.3, 6.0, 0.45, 1.2), heading: HEADING.east },
  // Lockers and a filing cabinet by the door; clutter in the south-west corner.
  { id: "lockers", rect: r(10.0, 11.2, 1.3, 0.54), heading: HEADING.north },
  { id: "cabinet", rect: r(11.6, 11.2, 0.51, 0.64), heading: HEADING.north },
  { id: "crate_stack", rect: r(0.4, 10.4, 1.76, 0.95), heading: HEADING.north },
  { id: "barrel", rect: r(2.4, 10.9, 0.6, 0.6), heading: HEADING.north },
  { id: "barrel", rect: r(3.1, 11.0, 0.6, 0.6), heading: HEADING.north },
  { id: "crate", rect: r(0.4, 9.2, 0.83, 0.83), heading: HEADING.east },
  // The break nook in the north-east: counter, espresso, fridge, cooler, sofa, lounge chair.
  { id: "counter", rect: r(13.9, 0.3, 1.84, 0.64), heading: HEADING.south },
  { id: "coffee_machine", rect: r(14.3, 0.4, 0.42, 0.4), heading: HEADING.south },
  { id: "fridge", rect: r(15.0, 1.4, 0.7, 0.7), heading: HEADING.west },
  { id: "water_cooler", rect: r(12.9, 0.3, 0.43, 0.37), heading: HEADING.south },
  { id: "couch", rect: r(13.4, 4.6, 2.0, 0.87), heading: HEADING.west },
  { id: "armchair", rect: r(11.6, 3.0, 0.86, 0.82), heading: HEADING.south },
  { id: "coffee_table", rect: r(12.4, 4.4, 1.1, 0.61), heading: HEADING.west },
  { id: "floor_lamp", rect: r(15.2, 3.3, 0.6, 0.4), heading: HEADING.west },
  { id: "jukebox", rect: r(15.2, 6.8, 0.9, 0.63), heading: HEADING.west },
  // Plants everywhere: never sterile.
  { id: "plant", rect: r(0.6, 0.5, 0.6, 0.6), heading: HEADING.south },
  { id: "plant", rect: r(15.0, 10.8, 0.6, 0.6), heading: HEADING.north },
  { id: "plant_small", rect: r(7.6, 0.6, 0.5, 0.5), heading: HEADING.south },
  { id: "planter", rect: r(4.4, 8.4, 1.7, 0.6), heading: HEADING.south },
  { id: "bistro_table", rect: r(12.6, 8.4, 0.8, 0.8), heading: HEADING.south },
];

/** Seats around the pods: two each side of each desk. */
export const SAMPLE_CHAIRS: readonly PiecePlacement[] = [4.2, 8.2].flatMap((x) =>
  [0.45, 1.15].flatMap((dx) => [
    { piece: "swivel_chair" as const, position: [x + dx, 0, 4.6 - 0.45] as const, rotationY: 0 },
    {
      piece: "swivel_chair" as const,
      position: [x + dx, 0, 4.6 + 1.2 + 0.45] as const,
      rotationY: Math.PI,
    },
  ]),
);

/** Laptops on the pods, screens toward the sitters. */
export const SAMPLE_LAPTOPS: readonly PiecePlacement[] = [4.2, 8.2].flatMap((x) =>
  [0.45, 1.15].flatMap((dx) => [
    { piece: "laptop" as const, position: [x + dx, 0.76, 4.6 + 0.3] as const, rotationY: Math.PI },
    { piece: "laptop" as const, position: [x + dx, 0.76, 4.6 + 0.9] as const, rotationY: 0 },
  ]),
);

/** The corridor junction south of the door: straight, cross, then a corner, a tee and a dead straight. */
export function sampleCorridors(): RoomShell {
  const x0 = ROOM.doorTile * TILE + TILE / 2 - CORRIDOR_WIDTH / 2;
  const z0 = ROOM.d * TILE + T;
  const W = CORRIDOR_WIDTH;
  const cells = [
    corridorCell("straight", 0, [x0, 0, z0]),
    corridorCell("cross", 0, [x0, 0, z0 + W]),
    corridorCell("corner", 2, [x0 + W, 0, z0 + W]),
    corridorCell("tee", 0, [x0 - W, 0, z0 + W]),
    corridorCell("straight", 0, [x0, 0, z0 + 2 * W]),
  ];
  return {
    pieces: cells.flatMap((c) => c.pieces),
    doors: [],
    beacons: [],
    lamps: cells.flatMap((c) => c.lamps),
  };
}

/** A 4 x 4 tile room being built west of the ops room. */
export const BUILD_SITE = { x: -12, z: 2 } as const;

export function sampleBuildSite(): RoomShell {
  const shell = roomShell({
    w: 4,
    d: 4,
    door: { side: "east", tile: 1 },
    lampEvery: 0,
    floor: "floor_steel",
  });
  const { x, z } = BUILD_SITE;
  const move = (p: PiecePlacement): PiecePlacement => ({
    ...p,
    position: [p.position[0] + x, p.position[1], p.position[2] + z],
  });
  // Only the north and west walls are up yet; the rest is scaffolding.
  const pieces = shell.pieces
    .filter(
      (p) =>
        !(
          (p.piece.startsWith("wall_rock") || p.piece === "wall_trim") &&
          (p.position[0] > 7 || p.position[2] > 7)
        ),
    )
    .map(move);
  const site: PiecePlacement[] = [
    { piece: "scaffold", position: [x + 7, 0, z + 1] },
    { piece: "scaffold", position: [x + 7, 0, z + 5] },
    { piece: "scaffold", position: [x + 3, 0, z + 7], rotationY: Math.PI / 2 },
    { piece: "crate_stack", position: [x + 2, 0, z + 2.2], rotationY: 0.3 },
    { piece: "crate", position: [x + 4.2, 0, z + 1.4], rotationY: -0.4 },
    { piece: "cable_drum", position: [x + 4.5, 0, z + 4.6], rotationY: 0.8 },
    { piece: "barrier", position: [x + 9.2, 0, z + 5.6], rotationY: Math.PI / 2 },
    { piece: "barrier", position: [x + 9.2, 0, z + 1.4], rotationY: Math.PI / 2 },
    { piece: "work_light", position: [x + 1.2, 0, z + 6.6], rotationY: Math.PI * 0.8 },
    { piece: "barrel", position: [x + 5.6, 0, z + 6.6] },
    { piece: "rock_pile", position: [x + 1.3, 0, z + 4.4], rotationY: 1.1 },
    { piece: "rock_pile", position: [x + 5.8, 0, z + 2.7], rotationY: 2.4 },
  ];
  return {
    pieces: [...pieces, ...site],
    doors: shell.doors.map((d) => ({
      ...d,
      position: [d.position[0] + x, d.position[1], d.position[2] + z] as const,
    })),
    beacons: shell.beacons.map((b) => ({
      ...b,
      position: [b.position[0] + x, b.position[1], b.position[2] + z] as const,
    })),
    lamps: [{ piece: "work_light", position: [x + 1.2, 0, z + 6.6], rotationY: Math.PI * 0.8 }],
  };
}

/** The catalogue apron: one of every piece in rows by category, east of the room. */
export const CATALOGUE_ORIGIN = { x: 22, z: 0 } as const;

export function catalogue(): {
  placements: PiecePlacement[];
  labels: { id: PieceId; position: readonly [number, number, number] }[];
} {
  const placements: PiecePlacement[] = [];
  const labels: { id: PieceId; position: readonly [number, number, number] }[] = [];
  const perRow = 8;
  const pitch = 3.6;
  PIECE_IDS.forEach((id, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = CATALOGUE_ORIGIN.x + col * pitch;
    const z = CATALOGUE_ORIGIN.z + row * pitch;
    placements.push({ piece: id, position: [x, 0, z] });
    // Labels float just above each piece, staggered so neighbours do not collide.
    // Labels lie on the floor in front of each piece, so they never collide.
    labels.push({ id, position: [x, 0.05, z + 1.45] });
  });
  return { placements, labels };
}
