import { describe, expect, test } from "bun:test";
import { PLINTH_HEIGHT, TILE, WALL_HEIGHT } from "./dimensions.ts";
import { pieceTriangles, triangleCount } from "./geometry/builder.ts";
import { PIECE_CATEGORIES, PIECE_IDS, PIECES, pieceGeometry, pieceSize } from "./kit.ts";

describe("lair kit pieces", () => {
  test.each(PIECE_IDS)("%s builds a finite, vertex-coloured, flat-normalled mesh", (id) => {
    const { body, glow } = pieceGeometry(id);
    for (const geo of glow ? [body, glow] : [body]) {
      const pos = geo.getAttribute("position");
      const nor = geo.getAttribute("normal");
      const col = geo.getAttribute("color");
      expect(pos.count).toBeGreaterThan(0);
      expect(pos.count % 3).toBe(0);
      expect(nor.count).toBe(pos.count);
      expect(col.count).toBe(pos.count);
      for (const v of pos.array as Float32Array) expect(Number.isFinite(v)).toBe(true);
      for (const v of col.array as Float32Array) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  test.each(PIECE_IDS)("%s stays inside its triangle budget", (id) => {
    const tris = pieceTriangles(pieceGeometry(id));
    expect(tris).toBeLessThanOrEqual(PIECES[id].budget);
  });

  test("every piece is low-poly (SPEC §12): none over 1.5k triangles, the kit under 16k in total", () => {
    let total = 0;
    for (const id of PIECE_IDS) {
      const tris = pieceTriangles(pieceGeometry(id));
      expect(tris).toBeLessThanOrEqual(1500);
      total += tris;
    }
    expect(total).toBeLessThan(16_000);
  });

  test("every category is used and labels are unique", () => {
    for (const c of PIECE_CATEGORIES)
      expect(PIECE_IDS.some((id) => PIECES[id].category === c)).toBe(true);
    const labels = PIECE_IDS.map((id) => PIECES[id].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("geometry is built once and shared", () => {
    expect(pieceGeometry("crate")).toBe(pieceGeometry("crate"));
  });

  test("pieces stand on the floor (nothing sinks more than a few centimetres)", () => {
    for (const id of PIECE_IDS) {
      // Floor slabs go below 0 by design; everything else starts at the floor.
      if (id.startsWith("floor_")) continue;
      const { body } = pieceGeometry(id);
      body.computeBoundingBox();
      expect(body.boundingBox?.min.y ?? 0).toBeGreaterThan(-0.1);
    }
  });
});

describe("structural pieces snap to the 2 m grid", () => {
  test.each(["wall_rock", "wall_rock_b", "wall_concrete", "wall_steel", "door_frame"] as const)(
    "%s is one tile long and wall high",
    (id) => {
      const s = pieceSize(id);
      expect(s.w).toBeCloseTo(TILE, 5);
      expect(s.h).toBeCloseTo(WALL_HEIGHT, 1);
    },
  );

  test("floors are one tile square with the top at y = 0", () => {
    for (const id of ["floor_concrete", "floor_concrete_worn", "floor_steel"] as const) {
      const { body } = pieceGeometry(id);
      body.computeBoundingBox();
      const box = body.boundingBox;
      expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeCloseTo(TILE, 1);
      expect((box?.max.z ?? 0) - (box?.min.z ?? 0)).toBeCloseTo(TILE, 1);
      expect(box?.max.y ?? 1).toBeLessThan(0.01);
    }
  });

  test("the ceiling-edge trim caps the wall top; the plinth rail is the cut edge below it", () => {
    const { body } = pieceGeometry("wall_trim");
    body.computeBoundingBox();
    expect(body.boundingBox?.max.y ?? 0).toBeGreaterThan(WALL_HEIGHT);
    expect(body.boundingBox?.min.y ?? 0).toBeLessThan(WALL_HEIGHT);
    expect(PLINTH_HEIGHT).toBeLessThan(1);
  });

  test("worn concrete has more detail than clean concrete (stains only on some tiles)", () => {
    expect(triangleCount(pieceGeometry("floor_concrete_worn").body)).toBeGreaterThan(
      triangleCount(pieceGeometry("floor_concrete").body),
    );
  });
});
