/**
 * Property tests for placement and routing (#181): over many seeded random
 * compounds, accepted rooms never overlap, keep the gap, and are all
 * reachable through 2-tile corridors; refusals are justified; results do
 * not depend on input order. A failure names the seed that reproduces it.
 */
import { describe, expect, test } from "bun:test";
import { ROOM_MIN_GAP_TILES } from "@regulus/protocol";
import { doorFront, expandTileRect, placementRect, tileRectsOverlap } from "./grid.ts";
import { computeCompoundLayout } from "./layout.ts";
import { defaultCompoundSpec, mainCorridor, specialRooms } from "./special.ts";
import { compoundStateOf } from "./state.ts";
import {
  layoutViolations,
  randomCompound,
  randomPlacement,
  rng,
  shuffled,
} from "./test-support.ts";
import { checkPlacement, layoutProblems } from "./validate.ts";

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);

describe("placement properties", () => {
  test.each(SEEDS)("seed %d: accepted rooms form a valid, fully connected compound", (seed) => {
    const spec = defaultCompoundSpec(seed % 3 === 0 ? 48 : 64);
    const rooms = randomCompound(seed, spec, 14);
    expect(rooms.length).toBeGreaterThan(2);
    const layout = computeCompoundLayout(spec, rooms);
    expect(layout.unreachable).toEqual([]);
    expect(layoutViolations(layout)).toEqual([]);
    expect(layoutProblems(spec, rooms)).toEqual([]);
  });

  test.each(SEEDS.slice(0, 20))("seed %d: every refusal is justified", (seed) => {
    const spec = defaultCompoundSpec();
    const rooms = randomCompound(seed, spec, 8);
    const r = rng(seed ^ 0x5bd1e995);
    const obstacles = [
      ...specialRooms(spec).map((s) => ({ id: s.kind, rect: s.rect })),
      ...rooms.map((o) => ({ id: o.id, rect: placementRect(o.placement) })),
    ];
    for (let i = 0; i < 150; i++) {
      const p = randomPlacement(r, spec);
      const rect = placementRect(p);
      const check = checkPlacement(spec, rooms, "candidate", p);
      const hits = obstacles.filter((o) => tileRectsOverlap(rect, o.rect)).map((o) => o.id);
      const onCorridor = tileRectsOverlap(rect, mainCorridor(spec));
      const halo = expandTileRect(rect, ROOM_MIN_GAP_TILES);
      const near = obstacles.filter((o) => tileRectsOverlap(halo, o.rect));
      if (check.ok) {
        expect(hits).toEqual([]);
        expect(onCorridor).toBe(false);
        expect(near).toEqual([]);
        expect(layoutViolations(check.layout)).toEqual([]);
        continue;
      }
      switch (check.reason) {
        case "overlap":
          expect(hits.length > 0 || onCorridor).toBe(true);
          break;
        case "too_close":
          expect(hits).toEqual([]);
          expect(near.length).toBeGreaterThan(0);
          break;
        case "door_blocked": {
          const f = doorFront(rect, p.doorSide);
          const outside = f.x < 0 || f.y < 0 || f.x + f.w > spec.width || f.y + f.d > spec.depth;
          expect(outside || obstacles.some((o) => tileRectsOverlap(f, o.rect))).toBe(true);
          break;
        }
        case "unreachable":
        case "blocks_room":
          // Never expected under the gap rule, but a refusal must still leave the compound valid.
          expect(layoutProblems(spec, rooms)).toEqual([]);
          break;
        default:
          expect(check.reason).toBe("out_of_bounds");
      }
    }
  });

  test.each(SEEDS.slice(0, 15))("seed %d: layout does not depend on input order", (seed) => {
    const spec = defaultCompoundSpec();
    const rooms = randomCompound(seed, spec, 12);
    const a = computeCompoundLayout(spec, rooms);
    const b = computeCompoundLayout(spec, shuffled(rooms, rng(seed + 1)));
    expect(b.corridors).toEqual(a.corridors);
    expect([...b.network.tiles]).toEqual([...a.network.tiles]);
    expect(compoundStateOf(b)).toEqual(compoundStateOf(a));
  });

  test.each(SEEDS.slice(0, 10))("seed %d: a room's old spot is ignored when moving it", (seed) => {
    const spec = defaultCompoundSpec();
    const rooms = randomCompound(seed, spec, 6);
    for (const room of rooms) {
      expect(checkPlacement(spec, rooms, room.id, room.placement).ok).toBe(true);
    }
  });

  test("the layout version changes with any room and is stable otherwise", () => {
    const spec = defaultCompoundSpec();
    const rooms = randomCompound(42, spec, 5);
    const v = compoundStateOf(computeCompoundLayout(spec, rooms)).version;
    expect(compoundStateOf(computeCompoundLayout(spec, rooms)).version).toBe(v);
    const fewer = compoundStateOf(computeCompoundLayout(spec, rooms.slice(1))).version;
    expect(fewer).not.toBe(v);
  });
});
