import { describe, expect, test } from "bun:test";
import { type FloorSummary, LOBBY_FLOOR_ID } from "@regulus/protocol";
import { findPath } from "../astar.ts";
import { doorApproach } from "./grid.ts";
import { computeCompoundLayout } from "./layout.ts";
import { buildCompoundNavGrid } from "./nav.ts";
import { defaultCompoundSpec } from "./special.ts";
import {
  compoundNavInput,
  compoundNavInputFromState,
  compoundStateOf,
  roomSummaryPlacement,
} from "./state.ts";
import { randomCompound } from "./test-support.ts";

const spec = defaultCompoundSpec();

const centre = (r: { x: number; y: number; w: number; d: number }) => ({
  x: (r.x + r.w / 2) * 2,
  z: (r.y + r.d / 2) * 2,
});

describe("compound nav grid", () => {
  test.each([3, 5, 8])("seed %d: every room's middle is walkable from the lobby", (seed) => {
    const layout = computeCompoundLayout(spec, randomCompound(seed, spec, 8));
    const grid = buildCompoundNavGrid(compoundNavInput(layout));
    const lobby = layout.specialRooms[0];
    if (!lobby) throw new Error("no lobby");
    const from = grid.worldToCell(centre(lobby.rect).x, centre(lobby.rect).z);
    const reach = grid.reachableFrom(from);
    for (const room of [...layout.specialRooms, ...layout.rooms]) {
      const c = centre(room.rect);
      expect(reach.has(grid.index(grid.worldToCell(c.x, c.z)))).toBe(true);
      const at = doorApproach(room.rect, room.doorSide);
      expect(grid.isWalkable(at.x, at.z)).toBe(true);
    }
  });

  test("walls block, doors open, rock blocks, a closed door shuts the room", () => {
    const placement = { gridX: 26, gridY: 30, width: 10, depth: 10, doorSide: "south" as const };
    const layout = computeCompoundLayout(spec, [{ id: "r", placement }]);
    const input = compoundNavInput(layout);
    const open = buildCompoundNavGrid(input);
    expect(open.isWalkable(52.25, 79.75)).toBe(false); // west wall strip of the room
    expect(open.isWalkable(1, 1)).toBe(false); // rock
    expect(open.isWalkable(62, 79.75)).toBe(true); // in the door
    const inside = open.worldToCell(60, 70);
    const corridor = open.worldToCell(60, 110);
    expect(findPath(open, inside, corridor)).not.toBeNull();
    const shut = buildCompoundNavGrid(input, { closedDoors: new Set(["r"]) });
    expect(findPath(shut, inside, corridor)).toBeNull();
  });

  test("the beach is reachable only through an open blast door", () => {
    const input = compoundNavInput(computeCompoundLayout(spec, []));
    const beach = { x: 64, z: 64 * 2 + 4 };
    const lobby = { x: 64, z: 120 };
    const closed = buildCompoundNavGrid(input);
    const opened = buildCompoundNavGrid(input, { blastDoorOpen: true });
    expect(closed.isWalkable(beach.x, beach.z)).toBe(true);
    const path = (g: typeof closed) =>
      findPath(g, g.worldToCell(lobby.x, lobby.z), g.worldToCell(beach.x, beach.z));
    expect(path(closed)).toBeNull();
    expect(path(opened)).not.toBeNull();
  });

  test("obstacles block cells", () => {
    const input = compoundNavInput(computeCompoundLayout(spec, []));
    const grid = buildCompoundNavGrid(input, { obstacles: [{ x: 60, z: 118, w: 2, d: 2 }] });
    expect(grid.isWalkable(61, 119)).toBe(false);
  });

  test("the published state rebuilds the same nav grid", () => {
    const layout = computeCompoundLayout(spec, randomCompound(21, spec, 7));
    const state = compoundStateOf(layout);
    const base = {
      name: "x",
      slug: "x",
      index: 1,
      paletteId: "p",
      robotsWorking: 0,
      robotsWaiting: 0,
      robotsTotal: 0,
      humansPresent: 0,
      buildState: "ready" as const,
      buildEndsAt: 0,
      deskCount: 1,
      decorStyle: "ops_room" as const,
    };
    const lobby = layout.specialRooms[0];
    if (!lobby) throw new Error("no lobby");
    const floors: FloorSummary[] = [
      { ...base, floorId: LOBBY_FLOOR_ID, ...roomSummaryPlacement(lobby) },
      ...layout.rooms.map((r) => ({ ...base, floorId: r.id, ...roomSummaryPlacement(r) })),
      { ...base, floorId: "unplaced", ...roomSummaryPlacement(lobby), gridX: -1, gridY: -1 },
    ];
    const a = buildCompoundNavGrid(compoundNavInput(layout));
    const b = buildCompoundNavGrid(compoundNavInputFromState(state, floors));
    expect(b.toAscii()).toBe(a.toAscii());
  });
});
