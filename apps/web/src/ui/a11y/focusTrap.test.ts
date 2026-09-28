import { describe, expect, test } from "bun:test";
import { nextFocusIndex, resolveTrapMove } from "./focusTrap.ts";

describe("nextFocusIndex", () => {
  test("cycles forward and wraps", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });
  test("cycles backward and wraps", () => {
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });
  test("focus outside the trap lands on the first / last item", () => {
    expect(nextFocusIndex(4, -1, false)).toBe(0);
    expect(nextFocusIndex(4, -1, true)).toBe(3);
    expect(nextFocusIndex(4, 99, false)).toBe(0);
  });
  test("single item stays put; empty trap yields -1", () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
  });
});

describe("resolveTrapMove", () => {
  test("always swallows Tab so focus cannot escape", () => {
    expect(resolveTrapMove(2, 1, false)).toEqual({ index: 0, preventDefault: true });
    expect(resolveTrapMove(2, 0, true)).toEqual({ index: 1, preventDefault: true });
    expect(resolveTrapMove(0, -1, false)).toEqual({ index: -1, preventDefault: true });
  });
});
