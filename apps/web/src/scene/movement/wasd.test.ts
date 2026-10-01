import { describe, expect, test } from "bun:test";
import { EMPTY_KEYS, inputVector, movementKeyFor, nextKeyState, screenAxes } from "./wasd.ts";

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

describe("Shift to run (#223)", () => {
  const ev = (key: string, shiftKey: boolean, editable = false) => ({ key, shiftKey, editable });

  test("Shift held runs; released stops", () => {
    let k = nextKeyState(EMPTY_KEYS, ev("Shift", true), true);
    expect(k.run).toBe(true);
    k = nextKeyState(k, ev("W", true), true);
    expect(k).toMatchObject({ forward: true, run: true });
    k = nextKeyState(k, ev("Shift", false), false);
    expect(k).toMatchObject({ forward: true, run: false });
  });

  test("Shift in a text field never starts a run, but its release there still stops one", () => {
    expect(nextKeyState(EMPTY_KEYS, ev("Shift", true, true), true).run).toBe(false);
    const running = { ...EMPTY_KEYS, run: true };
    expect(nextKeyState(running, ev("Shift", false, true), false).run).toBe(false);
  });

  test("any key event without Shift resyncs a stale run (Shift let go elsewhere)", () => {
    const running = { ...EMPTY_KEYS, forward: true, run: true };
    expect(nextKeyState(running, ev("w", false), true)).toMatchObject({
      forward: true,
      run: false,
    });
  });

  test("Ctrl/Alt chords are ignored; an unchanged state is returned as is", () => {
    expect(nextKeyState(EMPTY_KEYS, { ...ev("Shift", true), ctrlKey: true }, true).run).toBe(false);
    expect(nextKeyState(EMPTY_KEYS, ev("q", false), true)).toBe(EMPTY_KEYS);
  });
});
