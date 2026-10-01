/**
 * The corridor network as lair art (#186, SPEC §9.1, §12): one concrete
 * floor tile per corridor tile, and rock walls (with their trim, pipe run,
 * hazard strip and the odd caged lamp) wherever a corridor tile borders
 * solid rock. Where it borders a room, the room's own wall (or door) is
 * there already. Pendants hang down the middle every few tiles. Pieces are
 * grouped in square chunks so the scene can cull the network by chunk.
 * Pure; compound metres.
 */
import type { TileRect } from "@regulus/protocol";
import { WALL_YAW } from "../lair/assembly.ts";
import { TILE, WALL_THICKNESS } from "../lair/dimensions.ts";
import type { PiecePlacement } from "../lair/placements.ts";

/** Chunk edge, tiles. */
export const CORRIDOR_CHUNK_TILES = 12;

export interface CorridorChunk {
  /** `cx:cz` chunk key. */
  key: string;
  /** Bounds, metres. */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  pieces: PiecePlacement[];
  lamps: PiecePlacement[];
}

type Side = "north" | "south" | "east" | "west";
const SIDES: readonly Side[] = ["north", "east", "south", "west"];
const STEP: Readonly<Record<Side, readonly [number, number]>> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

export interface CorridorInput {
  width: number;
  depth: number;
  corridors: readonly TileRect[];
  /** Room footprints (tiles), so walls toward rooms are left to the room. */
  rooms: readonly TileRect[];
}

function mask(width: number, depth: number, rects: readonly TileRect[]): Uint8Array {
  const m = new Uint8Array(width * depth);
  for (const r of rects)
    for (let y = Math.max(0, r.y); y < Math.min(depth, r.y + r.d); y++)
      for (let x = Math.max(0, r.x); x < Math.min(width, r.x + r.w); x++) m[y * width + x] = 1;
  return m;
}

/** The corridor network's pieces in chunks. */
export function corridorChunks(input: CorridorInput): CorridorChunk[] {
  const { width, depth } = input;
  const corridor = mask(width, depth, input.corridors);
  const room = mask(width, depth, input.rooms);
  const at = (m: Uint8Array, x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < depth && m[y * width + x] === 1;
  const chunks = new Map<string, CorridorChunk>();
  const chunkOf = (x: number, y: number): CorridorChunk => {
    const cx = Math.floor(x / CORRIDOR_CHUNK_TILES);
    const cz = Math.floor(y / CORRIDOR_CHUNK_TILES);
    const key = `${cx}:${cz}`;
    let c = chunks.get(key);
    if (!c) {
      const span = CORRIDOR_CHUNK_TILES * TILE;
      c = {
        key,
        minX: cx * span - 1,
        minZ: cz * span - 1,
        maxX: (cx + 1) * span + 1,
        maxZ: (cz + 1) * span + 1,
        pieces: [],
        lamps: [],
      };
      chunks.set(key, c);
    }
    return c;
  };
  const T = WALL_THICKNESS;
  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(corridor, x, y)) continue;
      const chunk = chunkOf(x, y);
      const cx = x * TILE + TILE / 2;
      const cz = y * TILE + TILE / 2;
      chunk.pieces.push({
        piece: (x * 7 + y * 13) % 5 === 1 ? "floor_concrete_worn" : "floor_concrete",
        position: [cx, 0, cz],
        rotationY: ((x + y * 2) % 4) * (Math.PI / 2),
      });
      let walls = 0;
      for (const side of SIDES) {
        const [dx, dy] = STEP[side];
        const nx = x + dx;
        const ny = y + dy;
        if (at(corridor, nx, ny) || at(room, nx, ny)) continue;
        walls++;
        // Wall centred just outside the tile edge, its room side facing into the corridor.
        const yaw = WALL_YAW[side];
        const wx = cx + dx * (TILE / 2 + T / 2);
        const wz = cz + dy * (TILE / 2 + T / 2);
        const face: [number, number, number] = [cx + dx * (TILE / 2), 0, cz + dy * (TILE / 2)];
        chunk.pieces.push(
          {
            piece: (x + y) % 2 === 0 ? "wall_rock" : "wall_rock_b",
            position: [wx, 0, wz],
            rotationY: yaw,
          },
          { piece: "wall_trim", position: [wx, 0, wz], rotationY: yaw },
          { piece: "pipe_run", position: face, rotationY: yaw },
          {
            piece: "hazard_strip",
            position: [face[0] - dx * 0.2, 0, face[2] - dy * 0.2],
            rotationY: yaw,
          },
        );
        if ((x + y) % 3 === 0) {
          const lamp: PiecePlacement = { piece: "wall_lamp", position: face, rotationY: yaw };
          chunk.pieces.push(lamp);
          chunk.lamps.push(lamp);
        } else if ((x + y) % 3 === 1) {
          chunk.pieces.push({ piece: "cable_tray", position: face, rotationY: yaw });
        }
      }
      // Pillars where two walls meet at an outer corner of the tile.
      for (const [a, b] of [
        ["north", "east"],
        ["east", "south"],
        ["south", "west"],
        ["west", "north"],
      ] as const) {
        const [ax, ay] = STEP[a];
        const [bx, by] = STEP[b];
        const wallA = !at(corridor, x + ax, y + ay) && !at(room, x + ax, y + ay);
        const wallB = !at(corridor, x + bx, y + by) && !at(room, x + bx, y + by);
        if (!wallA || !wallB) continue;
        chunk.pieces.push({
          piece: "wall_pillar",
          position: [cx + (ax + bx) * (TILE / 2 + T / 2), 0, cz + (ay + by) * (TILE / 2 + T / 2)],
        });
      }
      // A pendant every few tiles down the corridor (never against a dead end's wall).
      if (walls <= 2 && (x * 3 + y * 5) % 4 === 0) {
        const lamp: PiecePlacement = { piece: "ceiling_light", position: [cx, 0, cz] };
        chunk.pieces.push(lamp);
        chunk.lamps.push(lamp);
      }
    }
  }
  return [...chunks.values()];
}
