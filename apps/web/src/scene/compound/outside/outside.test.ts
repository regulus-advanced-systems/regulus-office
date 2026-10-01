import { describe, expect, test } from "bun:test";
import { findPath, type NavGrid } from "@regulus/floor-layout";
import { compoundNavGrid, outsideRows } from "../navigation.ts";
import { rowPlacement, testWorld } from "../testing.ts";
import { lobbyOf } from "../world.ts";
import { evictionPoint } from "./guard.ts";
import {
  COVE_HALF,
  dockPoint,
  onBeach,
  outsideLayout,
  outsideObstacles,
  SHORE_MARGIN,
  shoreZ,
} from "./layout.ts";
import { distanceTo, OUTSIDE_NEAR, outsideWanted } from "./Outside.tsx";

const world = testWorld([{ id: "apollo", placement: rowPlacement(4), deskCount: 2 }]);
const layout = outsideLayout(world);
if (!layout) throw new Error("no outside");
const closed = compoundNavGrid(world);
const open = compoundNavGrid(world, { blastDoorOpen: true });
const lobby = lobbyOf(world);
if (!lobby) throw new Error("no lobby");
const inLobby = { x: layout.door.centre, z: layout.edgeZ - 3 };

function reachable(g: NavGrid, a: { x: number; z: number }, b: { x: number; z: number }) {
  return findPath(g, g.worldToCell(a.x, a.z), g.worldToCell(b.x, b.z)) !== null;
}

describe("the outside layout (#188)", () => {
  test("the doorway is the published blast door, in the lobby's south wall on the compound's edge", () => {
    expect(layout.edgeZ).toBe(world.depth * world.tileMetres);
    expect(layout.door.x0).toBe(world.blastDoor.x * world.tileMetres);
    expect(layout.door.x1 - layout.door.x0).toBe(world.blastDoor.width * world.tileMetres);
    expect(layout.edgeZ).toBe(lobby.origin.z + lobby.size.d);
  });

  test("the dock runs from the sand out past the waterline, and the nav grid reaches its end", () => {
    const { dock } = layout;
    const shore = shoreZ(layout, dock.x + dock.w / 2);
    expect(dock.z).toBeLessThan(shore - SHORE_MARGIN);
    expect(dock.z + dock.d).toBeGreaterThan(shore + 8);
    expect(layout.navEndZ).toBeGreaterThanOrEqual(dock.z + dock.d);
    expect(outsideRows(world)).toBe(world.outsideDepth + layout.extraTiles);
    expect(open.depth).toBeCloseTo(layout.navEndZ, 6);
  });

  test("the beach, the dock and the props: walkable sand and deck, blocked sea, rocks and palms", () => {
    const beach = { x: layout.door.centre, z: layout.edgeZ + 4 };
    expect(onBeach(layout, beach.x, beach.z)).toBe(true);
    expect(open.isWalkable(beach.x, beach.z)).toBe(true);
    // The sea, just past the waterline, and far out.
    const sea = { x: layout.door.centre - 6, z: shoreZ(layout, layout.door.centre - 6) + 1 };
    expect(open.isWalkable(sea.x, sea.z)).toBe(false);
    expect(open.isWalkable(layout.door.centre, layout.navEndZ - 0.5)).toBe(false);
    // Beyond the cove: the headlands.
    expect(open.isWalkable(layout.door.centre + COVE_HALF + 8, layout.edgeZ + 3)).toBe(false);
    // The dock's deck all the way out, over the sea.
    for (const t of [0, 0.5, 1]) {
      const p = dockPoint(layout, t);
      expect(open.isWalkable(p.x, p.z), `dock at ${t}`).toBe(true);
    }
    for (const r of layout.rocks.filter((r) => r.z < shoreZ(layout, r.x)))
      expect(open.isWalkable(r.x, r.z)).toBe(false);
    for (const p of layout.palms) expect(open.isWalkable(p.x, p.z)).toBe(false);
    expect(outsideObstacles(layout).every((r) => r.w > 0 && r.d > 0)).toBe(true);
  });

  test("shut, the doorway blocks and the beach is out of reach; open, the lobby reaches the dock end", () => {
    const doorway = { x: layout.door.centre, z: layout.edgeZ + 0.05 };
    const end = dockPoint(layout, 1);
    expect(closed.isWalkable(doorway.x, doorway.z)).toBe(false);
    expect(reachable(closed, inLobby, end)).toBe(false);
    expect(open.isWalkable(doorway.x, doorway.z)).toBe(true);
    expect(reachable(open, inLobby, end)).toBe(true);
    // Only the doorway opens: the lobby's wall either side of it stays solid.
    expect(open.isWalkable(layout.door.x0 - 1.5, layout.edgeZ + 0.05)).toBe(false);
    expect(open.isWalkable(layout.door.x1 + 1.5, layout.edgeZ + 0.05)).toBe(false);
  });

  test("both buttons stand on open floor, reachable from their side", () => {
    const [inside, outside] = layout.buttons;
    expect(closed.isWalkable(inside.stand.x, inside.stand.z)).toBe(true);
    expect(reachable(closed, inLobby, inside.stand)).toBe(true);
    expect(open.isWalkable(outside.stand.x, outside.stand.z)).toBe(true);
    expect(reachable(open, dockPoint(layout, 0.5), outside.stand)).toBe(true);
    // Outside with the door shut, the keypad is still reachable from the beach.
    expect(reachable(closed, dockPoint(layout, 0.5), outside.stand)).toBe(true);
  });

  test("someone in the doorway when it shuts is moved out to the nearest side", () => {
    const inside = { x: layout.door.centre + 1, z: layout.edgeZ - 0.1 };
    const outside = { x: layout.door.centre - 1, z: layout.edgeZ + 0.3 };
    for (const p of [inside, outside]) {
      expect(open.isWalkable(p.x, p.z)).toBe(true);
      const to = evictionPoint(closed, p);
      if (!to) throw new Error("not moved");
      expect(closed.isWalkable(to.x, to.z)).toBe(true);
      expect(Math.hypot(to.x - p.x, to.z - p.z)).toBeLessThan(1);
      expect(Math.sign(to.z - layout.edgeZ)).toBe(Math.sign(p.z - layout.edgeZ));
    }
    // Anyone on open ground stays put.
    expect(evictionPoint(closed, inLobby)).toBeNull();
  });

  test("no outside without a published blast door", () => {
    expect(outsideLayout({ ...world, outsideDepth: 0 })).toBeNull();
    expect(outsideLayout({ ...world, blastDoor: { x: 0, y: 0, width: 0 } })).toBeNull();
  });
});

describe("culling the outside", () => {
  test("drawn only on screen and near; the overview draws it; the low tier only within its draw distance", () => {
    expect(outsideWanted({ inFrustum: false, distance: 0, far: true, low: false })).toBe(false);
    expect(outsideWanted({ inFrustum: true, distance: 10, far: false, low: false })).toBe(true);
    expect(
      outsideWanted({ inFrustum: true, distance: OUTSIDE_NEAR + 1, far: false, low: false }),
    ).toBe(false);
    expect(outsideWanted({ inFrustum: true, distance: 200, far: true, low: false })).toBe(true);
    expect(outsideWanted({ inFrustum: true, distance: 40, far: true, low: true })).toBe(false);
    expect(outsideWanted({ inFrustum: true, distance: 20, far: false, low: true })).toBe(true);
  });

  test("deep in the compound the player is far from the outside", () => {
    const deep = { x: layout.door.centre, z: 4 };
    expect(distanceTo(layout.bounds, deep.x, deep.z)).toBeGreaterThan(OUTSIDE_NEAR);
    expect(distanceTo(layout.bounds, inLobby.x, inLobby.z)).toBeLessThan(2);
  });
});
