import { describe, expect, test } from "bun:test";
import { findPath, findWorldPath } from "./astar.ts";
import { buildNavGrid, NavGrid } from "./nav-grid.ts";
import { officeL2Template } from "./templates/office-l2.ts";

describe("findPath", () => {
  test("returns [start] when start equals goal", () => {
    const grid = new NavGrid(1, 1);
    expect(findPath(grid, { col: 0, row: 0 }, { col: 0, row: 0 })).toEqual([{ col: 0, row: 0 }]);
  });

  test("walks diagonally across open floor", () => {
    const grid = new NavGrid(2.5, 2.5);
    const path = findPath(grid, { col: 0, row: 0 }, { col: 4, row: 4 });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(5);
    expect(path?.at(-1)).toEqual({ col: 4, row: 4 });
  });

  test("routes around a wall and never cuts its corners", () => {
    const grid = new NavGrid(2.5, 2.5);
    for (let row = 0; row < 4; row++) grid.setWalkable({ col: 2, row }, false);
    const path = findPath(grid, { col: 0, row: 0 }, { col: 4, row: 0 });
    expect(path).not.toBeNull();
    if (!path) return;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1] as { col: number; row: number };
      const b = path[i] as { col: number; row: number };
      expect(Math.abs(a.col - b.col)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.row - b.row)).toBeLessThanOrEqual(1);
      expect(grid.isCellWalkable(b)).toBe(true);
      if (a.col !== b.col && a.row !== b.row) {
        expect(grid.isCellWalkable({ col: b.col, row: a.row })).toBe(true);
        expect(grid.isCellWalkable({ col: a.col, row: b.row })).toBe(true);
      }
    }
    expect(path.some((c) => c.row === 4)).toBe(true);
  });

  test("returns null for blocked endpoints or disconnected cells", () => {
    const grid = new NavGrid(1.5, 0.5);
    grid.setWalkable({ col: 1, row: 0 }, false);
    expect(findPath(grid, { col: 0, row: 0 }, { col: 2, row: 0 })).toBeNull();
    expect(findPath(grid, { col: 0, row: 0 }, { col: 1, row: 0 })).toBeNull();
    expect(findPath(grid, { col: 0, row: 0 }, { col: 9, row: 9 })).toBeNull();
  });

  test("findWorldPath returns cell centres from spawn to a desk", () => {
    const grid = buildNavGrid(officeL2Template);
    const seat = officeL2Template.seats.find((s) => s.id === "ceo-seat");
    if (!seat) throw new Error("ceo-seat missing");
    const path = findWorldPath(grid, officeL2Template.spawn, seat.pose);
    expect(path).not.toBeNull();
    expect(path?.at(-1)).toEqual({ x: seat.pose.x, z: seat.pose.z });
    for (const p of path ?? []) expect(grid.isWalkable(p.x, p.z)).toBe(true);
  });
});
