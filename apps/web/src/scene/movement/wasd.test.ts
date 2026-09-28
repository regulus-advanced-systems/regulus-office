import { describe, expect, test } from "bun:test";
import { EMPTY_KEYS, inputVector, movementKeyFor, screenAxes } from "./wasd.ts";

const close = (v: { x: number; z: number }, x: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 6);
  expect(v.z).toBeCloseTo(z, 6);
};

describe("wasd", () => {
  test("maps keys and arrows, case-insensitively", () => {
    expect(movementKeyFor("w")).toBe("forward");
    expect(movementKeyFor("W")).toBe("forward");
    expect(movementKeyFor("ArrowUp")).toBe("forward");
    expect(movementKeyFor("s")).toBe("back");
    expect(movementKeyFor("a")).toBe("left");
    expect(movementKeyFor("ArrowRight")).toBe("right");
    expect(movementKeyFor("e")).toBeNull();
  });

  test("W walks up-screen toward the back corner of the iso view (-x, -z)", () => {
    const k = Math.SQRT1_2;
    close(inputVector({ ...EMPTY_KEYS, forward: true }), -k, -k);
    close(inputVector({ ...EMPTY_KEYS, back: true }), k, k);
    close(inputVector({ ...EMPTY_KEYS, right: true }), k, -k);
    close(inputVector({ ...EMPTY_KEYS, left: true }), -k, k);
  });

  test("diagonals are unit length and opposite keys cancel", () => {
    close(inputVector({ ...EMPTY_KEYS, forward: true, right: true }), 0, -1);
    close(inputVector({ ...EMPTY_KEYS, forward: true, left: true }), -1, 0);
    close(inputVector({ ...EMPTY_KEYS, forward: true, back: true }), 0, 0);
    close(inputVector(EMPTY_KEYS), 0, 0);
  });

  test("axes follow the camera yaw", () => {
    const axes = screenAxes(0);
    close(axes.forward, 0, -1);
    close(axes.right, 1, 0);
    close(inputVector({ ...EMPTY_KEYS, forward: true }, 90), -1, 0);
  });
});
