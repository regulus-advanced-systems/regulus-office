import { describe, expect, test } from "bun:test";
import { CORRIDOR_CHUNK_TILES, corridorChunks } from "./corridors.ts";
import { rowPlacement, testWorld } from "./testing.ts";

const world = testWorld([{ id: "a", placement: rowPlacement(4) }]);
const chunks = corridorChunks({
  width: world.width,
  depth: world.depth,
  corridors: world.corridors,
  rooms: world.rooms.map((r) => r.rect),
});
const pieces = chunks.flatMap((c) => c.pieces);
const tiles = world.corridors.reduce((n, c) => n + c.w * c.d, 0);

describe("corridor art (#186)", () => {
  test("one floor tile per corridor tile, in its chunk", () => {
    const floors = pieces.filter((p) => p.piece.startsWith("floor_"));
    expect(floors).toHaveLength(tiles);
    for (const c of chunks)
      for (const p of c.pieces.filter((x) => x.piece.startsWith("floor_"))) {
        expect(p.position[0]).toBeGreaterThanOrEqual(c.minX);
        expect(p.position[0]).toBeLessThanOrEqual(c.maxX);
        expect(p.position[2]).toBeGreaterThanOrEqual(c.minZ);
        expect(p.position[2]).toBeLessThanOrEqual(c.maxZ);
      }
    const span = CORRIDOR_CHUNK_TILES * world.tileMetres;
    for (const c of chunks) expect(c.maxX - c.minX).toBe(span + 2);
  });

  test("walls only against rock: never inside a room's footprint or across a corridor", () => {
    const walls = pieces.filter((p) => p.piece === "wall_rock" || p.piece === "wall_rock_b");
    expect(walls.length).toBeGreaterThan(0);
    const m = world.tileMetres;
    const isCorridor = (x: number, z: number) =>
      world.corridors.some(
        (c) => x >= c.x * m && x < (c.x + c.w) * m && z >= c.y * m && z < (c.y + c.d) * m,
      );
    const isRoom = (x: number, z: number) =>
      world.rooms.some(
        (r) =>
          x >= r.origin.x &&
          x < r.origin.x + r.size.w &&
          z >= r.origin.z &&
          z < r.origin.z + r.size.d,
      );
    for (const w of walls) {
      expect(isCorridor(w.position[0], w.position[2])).toBe(false);
      expect(isRoom(w.position[0], w.position[2])).toBe(false);
    }
  });

  test("lamps light the corridors", () => {
    expect(chunks.flatMap((c) => c.lamps).length).toBeGreaterThan(tiles / 12);
  });
});
