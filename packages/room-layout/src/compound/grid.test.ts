import { describe, expect, test } from "bun:test";
import { MAX_COMPOUND_SIZE_TILES, MIN_COMPOUND_SIZE_TILES } from "@regulus/protocol";
import { HEADING } from "../geometry.ts";
import { doorApproach, doorFront, doorStart, tilesToRects } from "./grid.ts";
import {
  blastDoor,
  compoundSpecProblems,
  defaultCompoundSpec,
  mainCorridor,
  specialRooms,
} from "./special.ts";
import { rng } from "./test-support.ts";

const room = { x: 10, y: 20, w: 8, d: 6 };

describe("doors", () => {
  test("a door is centred on its wall and its block lies outside the room", () => {
    expect(doorStart(room, "north")).toEqual({ x: 13, y: 20 });
    expect(doorStart(room, "south")).toEqual({ x: 13, y: 26 });
    expect(doorStart(room, "west")).toEqual({ x: 10, y: 22 });
    expect(doorStart(room, "east")).toEqual({ x: 18, y: 22 });
    expect(doorFront(room, "north")).toEqual({ x: 13, y: 18, w: 2, d: 2 });
    expect(doorFront(room, "south")).toEqual({ x: 13, y: 26, w: 2, d: 2 });
    expect(doorFront(room, "west")).toEqual({ x: 8, y: 22, w: 2, d: 2 });
    expect(doorFront(room, "east")).toEqual({ x: 18, y: 22, w: 2, d: 2 });
  });

  test("the approach pose stands in the corridor facing into the room", () => {
    expect(doorApproach(room, "south")).toEqual({ x: 28, z: 54, heading: HEADING.north });
    expect(doorApproach(room, "north")).toEqual({ x: 28, z: 38, heading: HEADING.south });
    expect(doorApproach(room, "east")).toEqual({ x: 38, z: 46, heading: HEADING.west });
    expect(doorApproach(room, "west")).toEqual({ x: 18, z: 46, heading: HEADING.east });
  });
});

describe("tilesToRects", () => {
  test.each([1, 2, 3, 4, 5, 6])(
    "seed %d: rects are disjoint and cover exactly the tiles",
    (seed) => {
      const r = rng(seed);
      const w = 23;
      const d = 17;
      const tiles = new Uint8Array(w * d).map(() => (r() < 0.45 ? 1 : 0));
      const covered = new Uint8Array(w * d);
      for (const rect of tilesToRects(tiles, w, d)) {
        for (let y = rect.y; y < rect.y + rect.d; y++)
          for (let x = rect.x; x < rect.x + rect.w; x++)
            covered[y * w + x] = (covered[y * w + x] ?? 0) + 1;
      }
      expect([...covered]).toEqual([...tiles]);
    },
  );

  test("merges a straight corridor into one rect", () => {
    const tiles = new Uint8Array(6 * 4);
    for (let y = 1; y < 3; y++) for (let x = 0; x < 6; x++) tiles[y * 6 + x] = 1;
    expect(tilesToRects(tiles, 6, 4)).toEqual([{ x: 0, y: 1, w: 6, d: 2 }]);
  });
});

describe("special rooms", () => {
  test("the default compound: lobby centred on the south edge, special rooms either side", () => {
    const spec = defaultCompoundSpec();
    expect(spec).toEqual({ width: 64, depth: 64, lobby: { x: 26, y: 56, w: 12, d: 8 } });
    const [lobby, conference, breakRoom] = specialRooms(spec);
    expect(lobby?.doorSide).toBe("north");
    expect(conference?.rect).toEqual({ x: 12, y: 56, w: 10, d: 8 });
    expect(breakRoom?.rect).toEqual({ x: 42, y: 56, w: 8, d: 8 });
    expect(mainCorridor(spec)).toEqual({ x: 2, y: 54, w: 60, d: 2 });
    expect(blastDoor(spec)).toEqual({ x: 30, y: 64, width: 4 });
  });

  test("every allowed size gives a valid spec; others are reported", () => {
    for (let s = MIN_COMPOUND_SIZE_TILES; s <= MAX_COMPOUND_SIZE_TILES; s += 13) {
      expect(compoundSpecProblems(defaultCompoundSpec(s))).toEqual([]);
    }
    expect(compoundSpecProblems(defaultCompoundSpec(40)).length).toBeGreaterThan(0);
    const floating = { ...defaultCompoundSpec(), lobby: { x: 26, y: 40, w: 12, d: 8 } };
    expect(compoundSpecProblems(floating)).toContain("lobby must touch the south edge");
  });
});
