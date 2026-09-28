import { describe, expect, test } from "bun:test";
import { buildNavGrid, NavGrid } from "./nav-grid.ts";
import { WALL_THICKNESS } from "./query.ts";
import { officeL2Template } from "./templates/office-l2.ts";

describe("NavGrid", () => {
  test("sizes the grid from the room and converts between world and cells", () => {
    const grid = new NavGrid(4, 3);
    expect(grid.cols).toBe(8);
    expect(grid.rows).toBe(6);
    expect(grid.worldToCell(0.6, 2.9)).toEqual({ col: 1, row: 5 });
    expect(grid.cellToWorld({ col: 1, row: 5 })).toEqual({ x: 0.75, z: 2.75 });
    expect(grid.worldToCell(1.25, 1.75)).toEqual(grid.worldToCell(1.0, 1.5));
    expect(grid.cellAt(grid.index({ col: 3, row: 2 }))).toEqual({ col: 3, row: 2 });
  });

  test("rounds a non-multiple room size up to whole cells", () => {
    const grid = new NavGrid(3.2, 1.1, 0.5);
    expect(grid.cols).toBe(7);
    expect(grid.rows).toBe(3);
  });

  test("blockRect blocks overlapping cells but not cells that merely touch its edge", () => {
    const grid = new NavGrid(3, 3);
    grid.blockRect({ x: 1, z: 1, w: 1, d: 1 });
    expect(grid.isWalkable(1.25, 1.25)).toBe(false);
    expect(grid.isWalkable(1.75, 1.75)).toBe(false);
    expect(grid.isWalkable(0.75, 1.25)).toBe(true);
    expect(grid.isWalkable(2.25, 1.25)).toBe(true);
    expect(grid.isWalkable(1.25, 0.75)).toBe(true);
  });

  test("out-of-bounds points are not walkable", () => {
    const grid = new NavGrid(2, 2);
    expect(grid.isWalkable(-0.1, 0.5)).toBe(false);
    expect(grid.isWalkable(0.5, 2.1)).toBe(false);
    expect(grid.isCellWalkable({ col: 4, row: 0 })).toBe(false);
  });

  test("neighbours are 8-connected in the open", () => {
    const grid = new NavGrid(3, 3);
    expect(grid.neighbours({ col: 2, row: 2 })).toHaveLength(8);
    expect(grid.neighbours({ col: 0, row: 0 })).toHaveLength(3);
  });

  test("neighbours never cut a corner past a blocked cell", () => {
    const grid = new NavGrid(2, 2);
    grid.setWalkable({ col: 1, row: 0 }, false);
    const next = grid.neighbours({ col: 0, row: 0 });
    expect(next).toContainEqual({ col: 0, row: 1 });
    expect(next).not.toContainEqual({ col: 1, row: 1 });
    expect(next).not.toContainEqual({ col: 1, row: 0 });
    grid.setWalkable({ col: 1, row: 0 }, true);
    expect(grid.neighbours({ col: 0, row: 0 })).toContainEqual({ col: 1, row: 1 });
  });

  test("reachableFrom floods only the connected component", () => {
    const grid = new NavGrid(2.5, 0.5);
    grid.setWalkable({ col: 2, row: 0 }, false);
    const reach = grid.reachableFrom({ col: 0, row: 0 });
    expect(reach.has(grid.index({ col: 1, row: 0 }))).toBe(true);
    expect(reach.has(grid.index({ col: 3, row: 0 }))).toBe(false);
    expect(grid.reachableFrom({ col: 2, row: 0 }).size).toBe(0);
  });

  test("toAscii renders one line per row", () => {
    const grid = new NavGrid(1, 1);
    grid.setWalkable({ col: 1, row: 1 }, false);
    expect(grid.toAscii()).toBe("..\n.#");
  });
});

describe("buildNavGrid", () => {
  const grid = buildNavGrid(officeL2Template);

  test("uses 0.5 m cells covering the whole room", () => {
    expect(grid.cellSize).toBe(0.5);
    expect(grid.cols).toBe(officeL2Template.size.width / 0.5);
    expect(grid.rows).toBe(officeL2Template.size.depth / 0.5);
  });

  test("walls block a strip of cells along the perimeter", () => {
    expect(WALL_THICKNESS).toBeGreaterThan(0);
    for (let col = 0; col < grid.cols; col++) {
      expect(grid.isCellWalkable({ col, row: 0 })).toBe(false);
      expect(grid.isCellWalkable({ col, row: grid.rows - 1 })).toBe(false);
    }
    for (let row = 0; row < grid.rows; row++) {
      expect(grid.isCellWalkable({ col: 0, row })).toBe(false);
      expect(grid.isCellWalkable({ col: grid.cols - 1, row })).toBe(false);
    }
  });

  test("obstacles and the elevator recess are blocked, open floor is walkable", () => {
    const table = officeL2Template.obstacles.find((o) => o.id === "table-a");
    if (!table) throw new Error("table-a missing");
    expect(grid.isWalkable(table.rect.x + 0.1, table.rect.z + 0.1)).toBe(false);
    const ev = officeL2Template.elevator.rect;
    expect(grid.isWalkable(ev.x + ev.w / 2, ev.z + ev.d / 2)).toBe(false);
    expect(grid.isWalkable(officeL2Template.spawn.x, officeL2Template.spawn.z)).toBe(true);
  });

  test("honours a custom cell size", () => {
    const fine = buildNavGrid(officeL2Template, { cellSize: 0.25 });
    expect(fine.cols).toBe(grid.cols * 2);
    expect(fine.isWalkable(officeL2Template.spawn.x, officeL2Template.spawn.z)).toBe(true);
  });
});
