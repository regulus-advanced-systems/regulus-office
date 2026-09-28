import { describe, expect, test } from "bun:test";
import { buildNavGrid, HEADING, lobbyTemplate, NavGrid } from "@regulus/floor-layout";
import {
  actionForCode,
  BODY_RADIUS,
  canStand,
  clampDt,
  forwardVector,
  MAX_FRAME_DT,
  moveVector,
  NAV_CELL_SIZE,
  rightVector,
  stepWithCollision,
} from "./fpvMove.ts";

const near = (v: { x: number; z: number }, x: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 9);
  expect(v.z).toBeCloseTo(z, 9);
};

describe("key mapping", () => {
  test("WASD and arrows map by physical code; anything else is ignored", () => {
    expect(actionForCode("KeyW")).toBe("forward");
    expect(actionForCode("ArrowUp")).toBe("forward");
    expect(actionForCode("KeyS")).toBe("back");
    expect(actionForCode("KeyA")).toBe("left");
    expect(actionForCode("ArrowRight")).toBe("right");
    expect(actionForCode("KeyV")).toBeNull();
    expect(actionForCode("Space")).toBeNull();
  });
});

describe("moveVector", () => {
  test("follows the floor-layout heading convention", () => {
    near(forwardVector(HEADING.north), 0, -1);
    near(forwardVector(HEADING.west), -1, 0);
    near(forwardVector(HEADING.south), 0, 1);
    near(forwardVector(HEADING.east), 1, 0);
    near(rightVector(HEADING.north), 1, 0);
    near(rightVector(HEADING.west), 0, -1);
  });

  test("forward at yaw 0 walks north; strafe right walks east", () => {
    near(moveVector(["forward"], 0), 0, -1);
    near(moveVector(["right"], 0), 1, 0);
    near(moveVector(["back"], 0), 0, 1);
    near(moveVector(["left"], 0), -1, 0);
  });

  test("is relative to the camera yaw", () => {
    near(moveVector(["forward"], HEADING.west), -1, 0);
    near(moveVector(["right"], HEADING.west), 0, -1);
    near(moveVector(["forward"], Math.PI / 4), -Math.SQRT1_2, -Math.SQRT1_2);
  });

  test("diagonals are unit length; opposing keys cancel", () => {
    const d = moveVector(new Set(["forward", "right"]), 0);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 9);
    near(d, Math.SQRT1_2, -Math.SQRT1_2);
    near(moveVector(["forward", "back"], 0), 0, 0);
    near(moveVector([], 1.3), 0, 0);
  });
});

describe("clampDt", () => {
  test("caps long frames and rejects garbage", () => {
    expect(clampDt(0.016)).toBe(0.016);
    expect(clampDt(1)).toBe(MAX_FRAME_DT);
    expect(clampDt(-1)).toBe(0);
    expect(clampDt(Number.NaN)).toBe(0);
  });
});

describe("collision", () => {
  /** 4 x 4 m room with a north-south wall slab at x 2..2.25. */
  const grid = new NavGrid(4, 4, NAV_CELL_SIZE);
  grid.blockRect({ x: 2, z: 0, w: 0.25, d: 4 });

  test("canStand respects the body radius", () => {
    expect(canStand(grid, 1, 1)).toBe(true);
    expect(canStand(grid, 1.7, 1)).toBe(true);
    expect(canStand(grid, 1.9, 1)).toBe(false);
    expect(canStand(grid, 0.1, 1)).toBe(false);
    expect(canStand(grid, 0.1, 1, 0)).toBe(true);
  });

  test("free steps pass unchanged", () => {
    expect(stepWithCollision(grid, 1, 1, 0.3, -0.2)).toEqual({
      x: 1.3,
      z: 0.8,
      dx: 0.3,
      dz: -0.2,
      blocked: false,
    });
    expect(stepWithCollision(grid, 1, 1, 0, 0).blocked).toBe(false);
  });

  test("a wall blocks head-on movement and the step is dropped", () => {
    const s = stepWithCollision(grid, 1.7, 1, 0.5, 0);
    expect(s).toEqual({ x: 1.7, z: 1, dx: 0, dz: 0, blocked: true });
  });

  test("moving diagonally into a wall slides along it", () => {
    const s = stepWithCollision(grid, 1.7, 1, 0.5, 0.4);
    expect(s.blocked).toBe(true);
    expect(s.dx).toBe(0);
    expect(s.dz).toBe(0.4);
    expect(s.x).toBe(1.7);
    expect(s.z).toBeCloseTo(1.4, 9);
  });

  test("the room edge is solid", () => {
    const s = stepWithCollision(grid, 0.5, 0.5, -1, 0);
    expect(s.x).toBe(0.5);
    expect(s.blocked).toBe(true);
    expect(stepWithCollision(grid, 3.5, 3.5, 0, 10).z).toBe(3.5);
  });

  test("in the lobby the spawn is standable and the elevator recess blocks a walk north", () => {
    const lobby = buildNavGrid(lobbyTemplate, { cellSize: NAV_CELL_SIZE });
    const { x, z } = lobbyTemplate.spawn;
    expect(canStand(lobby, x, z, BODY_RADIUS)).toBe(true);
    let px = x;
    let pz = z;
    for (let i = 0; i < 40; i++) {
      const s = stepWithCollision(lobby, px, pz, 0, -0.05);
      px = s.x;
      pz = s.z;
    }
    expect(pz).toBeGreaterThan(lobbyTemplate.elevator.rect.d);
    expect(pz).toBeLessThan(z);
  });
});
