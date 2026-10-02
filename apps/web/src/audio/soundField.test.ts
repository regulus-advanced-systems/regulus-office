import { describe, expect, test } from "bun:test";
import { NavGrid } from "@regulus/room-layout";
import { buildSoundField } from "./soundField.ts";

/** 20 × 10 m at 0.5 m cells, with a wall down x = 10 m open only at its south end (z 8..10). */
function walledGrid(): NavGrid {
  const grid = new NavGrid(20, 10, 0.5);
  grid.blockRect({ x: 9.9, z: 0, w: 0.2, d: 7.9 });
  return grid;
}

describe("buildSoundField", () => {
  test("in the open the walking distance is the straight line (to a cell)", () => {
    const grid = new NavGrid(20, 10, 0.5);
    const field = buildSoundField(grid, { x: 2.25, z: 2.25 }, 50);
    expect(field.distanceAt(2.25, 2.25)).toBeCloseTo(0, 6);
    expect(field.distanceAt(8.25, 2.25)).toBeCloseTo(6, 4);
    // Diagonal steps cost √2: 4 m across and down is ~5.66 m.
    expect(field.distanceAt(6.25, 6.25)).toBeCloseTo(4 * Math.SQRT2, 4);
  });

  test("a wall sends the sound round through the gap", () => {
    const field = buildSoundField(walledGrid(), { x: 8.25, z: 1.25 }, 60);
    const straight = Math.hypot(12.25 - 8.25, 0);
    const around = field.distanceAt(12.25, 1.25);
    expect(around).toBeGreaterThan(straight + 10);
    expect(around).toBeLessThan(20);
  });

  test("stops at maxDistance: farther cells are out of reach and not visited", () => {
    const grid = new NavGrid(20, 10, 0.5);
    const near = buildSoundField(grid, { x: 1, z: 1 }, 5);
    expect(near.distanceAt(4, 1)).toBeLessThan(5);
    expect(near.distanceAt(19, 9)).toBe(Number.POSITIVE_INFINITY);
    expect(near.visited).toBeLessThan(grid.size / 4);
  });

  test("a source on furniture starts from the nearest free cell; a listener off the grid too", () => {
    const grid = new NavGrid(10, 10, 0.5);
    grid.blockRect({ x: 4, z: 4, w: 1.9, d: 1.9 });
    const field = buildSoundField(grid, { x: 5, z: 5 }, 30);
    expect(field.distanceAt(5, 5)).toBeLessThan(5);
    expect(field.distanceAt(1, 1)).toBeLessThan(10);
    expect(field.distanceAt(-5, -5)).toBe(Number.POSITIVE_INFINITY);
  });

  test("a sealed-off source is heard nowhere", () => {
    const grid = new NavGrid(10, 10, 0.5);
    grid.blockRect({ x: 0, z: 0, w: 10, d: 10 });
    const field = buildSoundField(grid, { x: 5, z: 5 }, 30);
    expect(field.visited).toBe(0);
    expect(field.distanceAt(5, 5)).toBe(Number.POSITIVE_INFINITY);
  });
});
