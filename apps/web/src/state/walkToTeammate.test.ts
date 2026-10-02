import { describe, expect, test } from "bun:test";
import { compoundNavGrid, lobbySpawn } from "../scene/compound/navigation.ts";
import { rowPlacement, testWorld } from "../scene/compound/testing.ts";
import { doorCentre, type WorldRoom } from "../scene/compound/world.ts";
import { planPath } from "../scene/movement/navigation.ts";
import { BESIDE_METRES, teammateGoal } from "./walkToTeammate.ts";

// "apollo" is open to this viewer; "zeus" is someone else's room behind a shut door.
const world = testWorld(
  [
    { id: "apollo", placement: rowPlacement(4), deskCount: 2 },
    { id: "zeus", placement: rowPlacement(28, 10, 8), deskCount: 3 },
  ],
  ["apollo"],
);
const grid = compoundNavGrid(world);
const room = (id: string) => world.rooms.find((r) => r.id === id) as WorldRoom;
const middle = (r: WorldRoom) => ({ x: r.origin.x + r.size.w / 2, z: r.origin.z + r.size.d / 2 });
const inside = (r: WorldRoom, p: { x: number; z: number }) =>
  p.x >= r.origin.x &&
  p.x < r.origin.x + r.size.w &&
  p.z >= r.origin.z &&
  p.z < r.origin.z + r.size.d;

describe("walking to a teammate (#49)", () => {
  const me = lobbySpawn(world);

  test("a teammate behind a closed door: the path stops at that door, never inside", () => {
    const zeus = room("zeus");
    const them = middle(zeus);
    const goal = teammateGoal(world, me, them);
    expect(goal).toMatchObject({ atDoor: true, roomId: "zeus" });
    const path = planPath(grid, me, goal);
    expect(path).not.toBeNull();
    for (const p of path ?? []) expect(inside(zeus, p)).toBe(false);
    const end = path?.at(-1) ?? me;
    const door = doorCentre(zeus, world.tileMetres);
    expect(Math.hypot(end.x - door.x, end.z - door.z)).toBeLessThan(world.tileMetres * 1.5);
    // Asked to walk right up to them, A* finds no way through the shut door.
    expect(planPath(grid, me, them)).toBeNull();
  });

  test("a teammate in an open room: walk in and stop beside them", () => {
    const apollo = room("apollo");
    const them = middle(apollo);
    const goal = teammateGoal(world, me, them);
    expect(goal).toMatchObject({ atDoor: false, roomId: "apollo" });
    expect(Math.hypot(goal.x - them.x, goal.z - them.z)).toBeCloseTo(BESIDE_METRES, 5);
    const path = planPath(grid, me, goal);
    expect(path).not.toBeNull();
    const end = path?.at(-1) ?? me;
    expect(inside(apollo, end)).toBe(true);
    expect(Math.hypot(end.x - them.x, end.z - them.z)).toBeLessThan(BESIDE_METRES + 1.6);
  });

  test("a teammate in a corridor or the lobby: straight to them", () => {
    const them = { x: me.x + 3, z: me.z };
    const goal = teammateGoal(world, me, them);
    expect(goal).toMatchObject({ atDoor: false, roomId: "lobby" });
    expect(goal.x).toBeCloseTo(them.x - BESIDE_METRES, 5);
    expect(teammateGoal(world, them, them)).toMatchObject({ x: them.x, z: them.z });
  });
});
