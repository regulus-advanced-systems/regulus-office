import { describe, expect, test } from "bun:test";
import { HEADING, NavGrid } from "@regulus/floor-layout";
import { WALK_SPEED } from "../scene/movement/kinematics.ts";
import { planPath } from "../scene/movement/navigation.ts";
import { createPlayerStore } from "./player.ts";

function storeWithGrid() {
  const grid = new NavGrid(6, 6, 0.25);
  grid.blockRect({ x: 2.5, z: 0, w: 1, d: 4 }); // a wall from the north edge down to z=4
  const store = createPlayerStore();
  store.getState().setNavigation({
    walkable: (x, z) => grid.isWalkable(x, z),
    plan: (from, to) => planPath(grid, from, to),
  });
  store.getState().spawnAt({ x: 1, z: 1, heading: HEADING.south });
  return { store, grid };
}

describe("player store", () => {
  test("spawns idle at a pose", () => {
    const { store } = storeWithGrid();
    expect(store.getState()).toMatchObject({ x: 1, z: 1, spawned: true, animation: "idle" });
  });

  test("applyInput walks at WALK_SPEED, faces the travel direction and cancels a click target", () => {
    const { store } = storeWithGrid();
    store.getState().setTarget(1, 5);
    expect(store.getState().path).not.toBeNull();
    store.getState().applyInput(0, 1, 0.5);
    const s = store.getState();
    expect(s.z).toBeCloseTo(1 + WALK_SPEED * 0.5);
    expect(s.heading).toBeCloseTo(HEADING.south);
    expect(s.animation).toBe("walk");
    expect(s.target).toBeNull();
    expect(s.path).toBeNull();
    expect(s.distanceWalked).toBeCloseTo(WALK_SPEED * 0.5);
  });

  test("applyInput is blocked by the grid and slides along it", () => {
    const { store } = storeWithGrid();
    store.getState().setPose(2.3, 1, 0);
    store.getState().applyInput(1, 0, 1); // straight into the wall: stops flush against it
    store.getState().applyInput(1, 0, 0.1);
    const atWall = store.getState().x;
    expect(atWall).toBeLessThan(2.5);
    expect(atWall).toBeGreaterThan(2.4);
    store.getState().applyInput(1, 0, 0.1); // pushing on: no movement, idle
    expect(store.getState().x).toBe(atWall);
    expect(store.getState().animation).toBe("idle");
    store.getState().applyInput(1, 1, 0.1); // diagonal: slides down the wall
    expect(store.getState().x).toBe(atWall);
    expect(store.getState().z).toBeGreaterThan(1);
    expect(store.getState().animation).toBe("walk");
  });

  test("setTarget plans around obstacles and advance follows until arrival", () => {
    const { store } = storeWithGrid();
    expect(store.getState().setTarget(5, 1)).toBe(true);
    const path = store.getState().path as { x: number; z: number }[];
    expect(path.length).toBeGreaterThan(1); // must go around the wall's south end
    for (let i = 0; i < 400 && store.getState().path; i++) store.getState().advance(1 / 60);
    const s = store.getState();
    expect(s.x).toBeCloseTo(5);
    expect(s.z).toBeCloseTo(1);
    expect(s.path).toBeNull();
    expect(s.target).toBeNull();
    expect(s.animation).toBe("idle");
    expect(s.distanceWalked).toBeGreaterThan(4);
  });

  test("walk animation while on the way, idle once there or when the path is cleared", () => {
    const { store } = storeWithGrid();
    store.getState().setTarget(1, 4);
    store.getState().advance(0.1);
    expect(store.getState().animation).toBe("walk");
    store.getState().clearTarget();
    store.getState().advance(0.1);
    expect(store.getState().animation).toBe("idle");
  });

  test("an unreachable target is rejected and clears the previous one", () => {
    const { store } = storeWithGrid();
    store.getState().setTarget(1, 4);
    expect(store.getState().setTarget(50, 50)).toBe(false);
    expect(store.getState().target).toBeNull();
    expect(store.getState().path).toBeNull();
  });

  test("without navigation, setTarget walks a straight line", () => {
    const store = createPlayerStore();
    store.getState().spawnAt({ x: 0, z: 0, heading: 0 });
    store.getState().setTarget(3, 0);
    expect(store.getState().path).toEqual([{ x: 3, z: 0 }]);
    store.getState().advance(10);
    expect(store.getState().x).toBeCloseTo(3);
  });

  test("advance ignores non-positive and zero-length input", () => {
    const store = createPlayerStore();
    store.getState().applyInput(0, 0, 1);
    store.getState().applyInput(1, 0, 0);
    expect(store.getState()).toMatchObject({ x: 0, z: 0, distanceWalked: 0 });
  });
});
