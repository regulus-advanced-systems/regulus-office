import { describe, expect, test } from "bun:test";
import { CROSSFADE_MS, crossfadeDone, crossfadeOpacity, crossfadeSwapped } from "./crossfade.ts";

describe("crossfade timing", () => {
  test("lasts 300 ms per SPEC §9.2", () => {
    expect(CROSSFADE_MS).toBe(300);
  });

  test("opacity ramps to 1 at the midpoint and back to 0 at the end", () => {
    expect(crossfadeOpacity(0)).toBe(0);
    expect(crossfadeOpacity(75)).toBeCloseTo(0.5, 9);
    expect(crossfadeOpacity(150)).toBe(1);
    expect(crossfadeOpacity(225)).toBeCloseTo(0.5, 9);
    expect(crossfadeOpacity(300)).toBe(0);
    expect(crossfadeOpacity(1000)).toBe(0);
  });

  test("garbage input is harmless", () => {
    expect(crossfadeOpacity(-10)).toBe(0);
    expect(crossfadeOpacity(Number.NaN)).toBe(0);
    expect(crossfadeOpacity(50, 0)).toBe(0);
    expect(crossfadeOpacity(50, 100)).toBe(1);
  });

  test("the camera swaps at the midpoint, the fade ends at the duration", () => {
    expect(crossfadeSwapped(149)).toBe(false);
    expect(crossfadeSwapped(150)).toBe(true);
    expect(crossfadeDone(299)).toBe(false);
    expect(crossfadeDone(300)).toBe(true);
    expect(crossfadeSwapped(50, 100)).toBe(true);
  });
});
