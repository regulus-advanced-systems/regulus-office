/**
 * Assemblers (#183): turn a room rectangle or a corridor cell into piece
 * placements, so a whole room shell or corridor network draws as a handful
 * of instanced meshes. Pure functions; #186 builds the compound from these.
 *
 * Coordinates follow room-layout: metres, a room's origin at its north-west
 * corner, x east, z south, y up; a wall's room side faces into the room.
 */
import type { CompassDirection } from "@regulus/room-layout";
import { CORRIDOR_WIDTH, TILE, WALL_THICKNESS } from "./dimensions.ts";
import type { Vec3 } from "./geometry/builder.ts";
import { DOOR_BEACON_POS } from "./geometry/doors.ts";
import type { PieceId } from "./kit.ts";
import type { PiecePlacement } from "./placements.ts";

const T = WALL_THICKNESS;

/** Yaw that turns a piece's +z front to face into the room from each wall. */
export const WALL_YAW: Readonly<Record<CompassDirection, number>> = {
  north: 0,
  south: Math.PI,
  west: Math.PI / 2,
  east: -Math.PI / 2,
};

export type WallFinishId = "wall_rock" | "wall_rock_b" | "wall_concrete" | "wall_steel";

export interface RoomShellOptions {
  /** Size in tiles. */
  w: number;
  d: number;
  /** The door: its side, first tile and how many tiles it spans (one frame per tile). */
  door?: { side: CompassDirection; tile: number; span?: number };
  /** Finish per wall; rock alternates its two variants so a run does not repeat. */
  finish?: Partial<Record<CompassDirection, WallFinishId>>;
  /** Floor piece; concrete goes worn on some tiles. */
  floor?: PieceId;
  /** Wall lamp on every n-th segment (0: none). */
  lampEvery?: number;
  /** Walls that carry the pipe run and cable tray. */
  services?: readonly CompassDirection[];
  /** x (metres from the west wall) of exposed beams spanning north-south, each with pendants. */
  beams?: readonly number[];
}

export interface RoomShell {
  pieces: PiecePlacement[];
  /** Door frames: centre of the doorway, facing into the room, and its width in tiles. */
  doors: { position: Vec3; rotationY: number; span?: number }[];
  beacons: { position: Vec3; rotationY: number }[];
  lamps: PiecePlacement[];
}

/** Centre of segment `i` along a wall, with the wall's inner face on the room edge. */
export function wallSegment(side: CompassDirection, i: number, w: number, d: number): Vec3 {
  const along = i * TILE + TILE / 2;
  switch (side) {
    case "north":
      return [along, 0, -T / 2];
    case "south":
      return [along, 0, d * TILE + T / 2];
    case "west":
      return [-T / 2, 0, along];
    case "east":
      return [w * TILE + T / 2, 0, along];
  }
}

/** Offset `dist` metres from a wall's inner face into the room, for wall-mounted pieces. */
function intoRoom(side: CompassDirection, p: Vec3, dist: number): Vec3 {
  const n = { north: [0, 1], south: [0, -1], west: [1, 0], east: [-1, 0] }[side];
  return [p[0] + (n[0] ?? 0) * dist, p[1], p[2] + (n[1] ?? 0) * dist];
}

const SIDES: readonly CompassDirection[] = ["north", "east", "south", "west"];

export function roomShell(opts: RoomShellOptions): RoomShell {
  const { w, d } = opts;
  const pieces: PiecePlacement[] = [];
  const doors: RoomShell["doors"] = [];
  const beacons: RoomShell["beacons"] = [];
  const lamps: PiecePlacement[] = [];
  const floor = opts.floor ?? "floor_concrete";
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      // Quarter turns per tile so the joints and stains do not line up.
      pieces.push({
        piece: floorPiece(floor, i, j),
        position: [i * TILE + 1, 0, j * TILE + 1],
        rotationY: ((i * 3 + j) % 4) * (Math.PI / 2),
      });
    }
  }
  const lampEvery = opts.lampEvery ?? 2;
  for (const side of SIDES) {
    const n = side === "north" || side === "south" ? w : d;
    const yaw = WALL_YAW[side];
    const finish = opts.finish?.[side] ?? "wall_rock";
    for (let i = 0; i < n; i++) {
      const at = wallSegment(side, i, w, d);
      const door = opts.door?.side === side ? opts.door : undefined;
      const span = door?.span ?? 1;
      const isDoor = door !== undefined && i >= door.tile && i < door.tile + span;
      if (isDoor) {
        if (i === door.tile + span - 1) {
          // One door across the whole doorway, with a beacon over each face.
          const first = wallSegment(side, door.tile, w, d);
          const mid: Vec3 = [(first[0] + at[0]) / 2, 0, (first[2] + at[2]) / 2];
          doors.push({ position: mid, rotationY: yaw, span });
          const c = Math.cos(yaw);
          const s = Math.sin(yaw);
          const [bx, by, bz] = DOOR_BEACON_POS;
          for (const face of [1, -1]) {
            const lx = bx * face;
            const lz = bz * face;
            beacons.push({
              position: [mid[0] + lx * c + lz * s, by - 0.02, mid[2] - lx * s + lz * c],
              rotationY: face > 0 ? yaw : yaw + Math.PI,
            });
          }
        }
        pieces.push({
          piece: "hazard_strip",
          position: intoRoom(side, at, T / 2 + 0.3),
          rotationY: yaw,
        });
        continue;
      }
      const piece: PieceId = finish === "wall_rock" && i % 2 === 1 ? "wall_rock_b" : finish;
      pieces.push({ piece, position: at, rotationY: yaw });
      pieces.push({ piece: "wall_trim", position: at, rotationY: yaw });
      const face = intoRoom(side, at, T / 2);
      if (opts.services?.includes(side)) {
        pieces.push({ piece: "pipe_run", position: face, rotationY: yaw });
        if (i % 2 === 0) pieces.push({ piece: "cable_tray", position: face, rotationY: yaw });
      }
      if (lampEvery > 0 && i % lampEvery === Math.floor(lampEvery / 2) % lampEvery) {
        const lamp: PiecePlacement = { piece: "wall_lamp", position: face, rotationY: yaw };
        pieces.push(lamp);
        lamps.push(lamp);
      }
    }
  }
  for (const [x, z] of [
    [-T / 2, -T / 2],
    [w * TILE + T / 2, -T / 2],
    [w * TILE + T / 2, d * TILE + T / 2],
    [-T / 2, d * TILE + T / 2],
  ] as const) {
    pieces.push({ piece: "wall_pillar", position: [x, 0, z] });
  }
  const depth = d * TILE;
  const pendants = Math.max(1, Math.floor(d / 3));
  for (const x of opts.beams ?? []) {
    pieces.push({
      piece: "ceiling_beam",
      position: [x, 0, depth / 2],
      rotationY: Math.PI / 2,
      scale: [depth + T, 1, 1],
    });
    for (let k = 1; k <= pendants; k++) {
      const lamp: PiecePlacement = {
        piece: "ceiling_light",
        position: [x, 0, (depth * k) / (pendants + 1)],
      };
      pieces.push(lamp);
      lamps.push(lamp);
    }
  }
  return { pieces, doors, beacons, lamps };
}

/** Concrete floors go worn (stained) on about one tile in four, scattered. */
export function floorPiece(floor: PieceId, i: number, j: number): PieceId {
  if (floor !== "floor_concrete") return floor;
  return (i * 7 + j * 13 + ((i * j) % 3)) % 4 === 1 ? "floor_concrete_worn" : "floor_concrete";
}

// ---- Corridors -------------------------------------------------------------------

export const CORRIDOR_KINDS = ["straight", "corner", "tee", "cross"] as const;
export type CorridorKind = (typeof CORRIDOR_KINDS)[number];

/** Open sides of each kind before rotation: straight runs N-S, the corner turns N-E, the tee closes N. */
export const CORRIDOR_OPEN: Readonly<Record<CorridorKind, readonly CompassDirection[]>> = {
  straight: ["north", "south"],
  corner: ["north", "east"],
  tee: ["east", "south", "west"],
  cross: ["north", "east", "south", "west"],
};

/** Rotate a compass side by quarter turns clockwise seen from above (north → east). */
export function rotateSide(side: CompassDirection, quarterTurns: number): CompassDirection {
  const i = SIDES.indexOf(side);
  return SIDES[(((i + quarterTurns) % 4) + 4) % 4] ?? side;
}

export function corridorOpenSides(kind: CorridorKind, quarterTurns = 0): CompassDirection[] {
  return CORRIDOR_OPEN[kind].map((s) => rotateSide(s, quarterTurns));
}

/**
 * One corridor cell (two tiles square) with its north-west corner at
 * `origin`: concrete floor, rock walls (with trims, lamps and services) on
 * the closed sides, pillars at the corners, hazard strips along the walls
 * and a pendant light in the middle.
 */
export function corridorCell(
  kind: CorridorKind,
  quarterTurns = 0,
  origin: Vec3 = [0, 0, 0],
): RoomShell {
  const open = new Set(corridorOpenSides(kind, quarterTurns));
  const tiles = CORRIDOR_WIDTH / TILE;
  const shell: RoomShell = { pieces: [], doors: [], beacons: [], lamps: [] };
  const add = (p: PiecePlacement) => {
    const placed = {
      ...p,
      position: [
        p.position[0] + origin[0],
        p.position[1] + origin[1],
        p.position[2] + origin[2],
      ] as const,
    };
    shell.pieces.push(placed);
    return placed;
  };
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++)
      add({
        piece: floorPiece("floor_concrete", i + Math.round(origin[0]), j + Math.round(origin[2])),
        position: [i * TILE + 1, 0, j * TILE + 1],
        rotationY: ((i + j * 2) % 4) * (Math.PI / 2),
      });
  }
  for (const side of SIDES) {
    if (open.has(side)) continue;
    const yaw = WALL_YAW[side];
    for (let i = 0; i < tiles; i++) {
      const at = wallSegment(side, i, tiles, tiles);
      add({ piece: i === 0 ? "wall_rock" : "wall_rock_b", position: at, rotationY: yaw });
      add({ piece: "wall_trim", position: at, rotationY: yaw });
      const face = intoRoom(side, at, T / 2);
      add({ piece: "pipe_run", position: face, rotationY: yaw });
      add({ piece: "hazard_strip", position: intoRoom(side, at, T / 2 + 0.2), rotationY: yaw });
      if (i === 0) shell.lamps.push(add({ piece: "wall_lamp", position: face, rotationY: yaw }));
      else add({ piece: "cable_tray", position: face, rotationY: yaw });
    }
  }
  const edge = tiles * TILE;
  // A pillar at each corner where a wall ends (either side next to it is closed).
  for (const [x, z, a, b] of [
    [-T / 2, -T / 2, "north", "west"],
    [edge + T / 2, -T / 2, "north", "east"],
    [edge + T / 2, edge + T / 2, "south", "east"],
    [-T / 2, edge + T / 2, "south", "west"],
  ] as const) {
    if (!open.has(a) || !open.has(b)) add({ piece: "wall_pillar", position: [x, 0, z] });
  }
  // A beam across the cell carries the pendant: wall to wall in a straight
  // run, pillar to pillar (diagonally) where the cell opens to the side.
  const span = edge + T;
  const ew = !open.has("east") && !open.has("west");
  const ns = !open.has("north") && !open.has("south");
  const [yaw, len] = ew ? [0, span] : ns ? [Math.PI / 2, span] : [-Math.PI / 4, span * Math.SQRT2];
  add({
    piece: "ceiling_beam",
    position: [edge / 2, 0, edge / 2],
    rotationY: yaw,
    scale: [len, 1, 1],
  });
  shell.lamps.push(add({ piece: "ceiling_light", position: [edge / 2, 0, edge / 2] }));
  return shell;
}
