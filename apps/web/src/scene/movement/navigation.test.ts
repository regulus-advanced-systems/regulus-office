import { describe, expect, test } from "bun:test";
import { lobbyTemplate, NavGrid } from "@regulus/room-layout";
import {
  lineClear,
  NAV_CELL_SIZE,
  navGridFor,
  nearestWalkable,
  planPath,
  smoothPath,
} from "./navigation.ts";

describe("navigation", () => {
  test("builds a 0.25 m grid per template and caches it", () => {
    const grid = navGridFor(lobbyTemplate);
    expect(grid.cellSize).toBe(NAV_CELL_SIZE);
    expect(grid.cols).toBe(lobbyTemplate.size.width / NAV_CELL_SIZE);
    expect(navGridFor(lobbyTemplate)).toBe(grid);
    expect(grid.isWalkable(lobbyTemplate.spawn.x, lobbyTemplate.spawn.z)).toBe(true);
  });

  test("nearestWalkable returns the point itself or the closest free cell centre", () => {
    const grid = new NavGrid(4, 4, 0.5);
    grid.blockRect({ x: 1, z: 1, w: 2, d: 2 });
    expect(nearestWalkable(grid, { x: 0.6, z: 0.6 })).toEqual({ x: 0.6, z: 0.6 });
    expect(nearestWalkable(grid, { x: 1.2, z: 2 })).toEqual({ x: 0.75, z: 1.75 });
    expect(nearestWalkable(grid, { x: 2, z: 2 }, 0.4)).toBeNull();
  });

  test("lineClear samples through blocked cells", () => {
    const grid = new NavGrid(4, 4, 0.5);
    grid.blockRect({ x: 1.5, z: 0, w: 1, d: 3 });
    expect(lineClear(grid, { x: 0.5, z: 0.5 }, { x: 3.5, z: 0.5 })).toBe(false);
    expect(lineClear(grid, { x: 0.5, z: 3.5 }, { x: 3.5, z: 3.5 })).toBe(true);
  });

  test("smoothPath drops staircase waypoints on open floor and keeps corners", () => {
    const grid = new NavGrid(4, 4, 0.5);
    const stairs = [
      { x: 0.25, z: 0.25 },
      { x: 0.75, z: 0.75 },
      { x: 1.25, z: 1.25 },
      { x: 1.75, z: 1.75 },
    ];
    expect(smoothPath(grid, stairs)).toEqual([
      { x: 0.25, z: 0.25 },
      { x: 1.75, z: 1.75 },
    ]);
    grid.blockRect({ x: 1.5, z: 0, w: 1, d: 3 });
    const around = [
      { x: 0.25, z: 0.25 },
      { x: 0.25, z: 3.5 },
      { x: 3.5, z: 3.5 },
      { x: 3.5, z: 0.25 },
    ];
    expect(smoothPath(grid, around)).toEqual(around);
  });

  test("planPath excludes the start, ends on the exact target and routes around furniture", () => {
    const grid = navGridFor(lobbyTemplate);
    const from = lobbyTemplate.spawn;
    const to = { x: 10.25, z: 3.75 }; // in front of the reception desk
    const path = planPath(grid, from, to);
    expect(path).not.toBeNull();
    const p = path as { x: number; z: number }[];
    expect(p[0]).not.toEqual({ x: from.x, z: from.z });
    expect(p[p.length - 1]).toEqual(to);
    let prev = { x: from.x, z: from.z };
    for (const point of p) {
      expect(lineClear(grid, prev, point)).toBe(true);
      prev = point;
    }
  });

  test("planPath snaps a click on furniture to the nearest free cell and rejects the void", () => {
    const grid = navGridFor(lobbyTemplate);
    const desk = lobbyTemplate.obstacles.find((o) => o.id === "reception-desk");
    if (!desk) throw new Error("fixture");
    const onDesk = { x: desk.rect.x + desk.rect.w / 2, z: desk.rect.z + desk.rect.d / 2 };
    const path = planPath(grid, lobbyTemplate.spawn, onDesk);
    expect(path).not.toBeNull();
    const end = (path as { x: number; z: number }[]).at(-1) as { x: number; z: number };
    expect(grid.isWalkable(end.x, end.z)).toBe(true);
    expect(Math.hypot(end.x - onDesk.x, end.z - onDesk.z)).toBeLessThan(1.5);
    expect(planPath(grid, lobbyTemplate.spawn, { x: -50, z: -50 })).toBeNull();
  });
});
