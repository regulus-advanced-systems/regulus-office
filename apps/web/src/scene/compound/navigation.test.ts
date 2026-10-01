import { describe, expect, test } from "bun:test";
import { findPath, type NavGrid } from "@regulus/floor-layout";
import { roomArt } from "./interiors.ts";
import { closedDoors, compoundNavGrid, lobbySpawn, navKey, wallBands } from "./navigation.ts";
import { rowPlacement, testWorld } from "./testing.ts";
import type { CompoundWorld, WorldRoom } from "./world.ts";

const world = testWorld(
  [
    { id: "apollo", placement: rowPlacement(4), deskCount: 2 },
    { id: "hermes", placement: rowPlacement(16), building: true },
    { id: "zeus", placement: rowPlacement(28, 10, 8), deskCount: 3 },
  ],
  ["apollo", "hermes"],
);
const grid = compoundNavGrid(world);
const room = (id: string) => world.rooms.find((r) => r.id === id) as WorldRoom;

function reachable(g: NavGrid, a: { x: number; z: number }, b: { x: number; z: number }) {
  return findPath(g, g.worldToCell(a.x, a.z), g.worldToCell(b.x, b.z)) !== null;
}

describe("the compound nav grid (#186)", () => {
  const spawn = lobbySpawn(world);

  test("the player spawns on open floor in the middle of the lobby, facing its door", () => {
    expect(grid.isWalkable(spawn.x, spawn.z)).toBe(true);
    const lobby = room("lobby");
    expect(spawn.x).toBe(lobby.origin.x + lobby.size.w / 2);
    expect(spawn.heading).toBe(0); // the lobby's door is north
  });

  test("every open room is reachable from the lobby, through corridors and doors", () => {
    for (const r of world.rooms.filter((x) => x.kind !== "project" || x.id === "apollo")) {
      const layout = roomArt(r).layout;
      const inside = layout
        ? { x: r.origin.x + layout.spawn.x, z: r.origin.z + layout.spawn.z }
        : { x: r.origin.x + r.size.w / 2, z: r.origin.z + 1.5 };
      expect(grid.isWalkable(inside.x, inside.z), `${r.id} inside`).toBe(true);
      expect(reachable(grid, spawn, inside), `${r.id} reachable`).toBe(true);
    }
  });

  test("rooms the viewer may not enter, and build sites, stay shut", () => {
    expect([...closedDoors(world)].sort()).toEqual(["hermes", "zeus"]);
    for (const id of ["hermes", "zeus"]) {
      const r = room(id);
      const middle = { x: r.origin.x + r.size.w / 2, z: r.origin.z + r.size.d / 2 };
      expect(grid.isWalkable(middle.x, middle.z)).toBe(true);
      expect(reachable(grid, spawn, middle), id).toBe(false);
    }
  });

  test("furniture blocks; every desk seat of an open room can be walked up to", () => {
    const apollo = room("apollo");
    const layout = roomArt(apollo).layout;
    if (!layout) throw new Error("no interior");
    for (const o of layout.obstacles) {
      const c = {
        x: apollo.origin.x + o.rect.x + o.rect.w / 2,
        z: apollo.origin.z + o.rect.z + o.rect.d / 2,
      };
      expect(grid.isWalkable(c.x, c.z), o.id).toBe(false);
    }
    for (const seat of layout.seats.filter((s) => s.kind === "desk")) {
      // Just behind the chair, where the e2e walk-up stands (navProbe STAND_BEHIND).
      const h = seat.pose.heading;
      const at = {
        x: apollo.origin.x + seat.pose.x + Math.sin(h) * 0.8,
        z: apollo.origin.z + seat.pose.z + Math.cos(h) * 0.8,
      };
      expect(grid.isWalkable(at.x, at.z), seat.id).toBe(true);
      expect(reachable(grid, spawn, at), seat.id).toBe(true);
    }
  });

  test("wall bands run round a room outside its footprint, open at the door", () => {
    const apollo = room("apollo");
    const bands = wallBands(apollo, world.tileMetres);
    expect(bands).toHaveLength(5); // three walls whole, the door wall in two parts
    const doorX = apollo.door.x * world.tileMetres + world.tileMetres;
    const below = apollo.origin.z + apollo.size.d + 0.1;
    expect(
      bands.some((b) => doorX >= b.x && doorX <= b.x + b.w && below >= b.z && below <= b.z + b.d),
    ).toBe(false);
  });

  test("the grid key follows layout, access, build state and settings", () => {
    const opened: CompoundWorld = {
      ...world,
      rooms: world.rooms.map((r) => (r.id === "zeus" ? { ...r, enterable: true } : r)),
    };
    expect(navKey(opened)).not.toBe(navKey(world));
    const counted: CompoundWorld = {
      ...world,
      rooms: world.rooms.map((r) => (r.id === "apollo" ? { ...r, robotsWorking: 3 } : r)),
    };
    expect(navKey(counted)).toBe(navKey(world));
  });
});
