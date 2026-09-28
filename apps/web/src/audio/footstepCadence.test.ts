import { describe, expect, test } from "bun:test";
import { createFootstepCadence, STRIDE_METRES } from "./footstepCadence.ts";

describe("footstep cadence", () => {
  test("fires one step per stride, accumulating partial frames", () => {
    const c = createFootstepCadence(0.5);
    expect(c.advance(0.2)).toBe(0);
    expect(c.advance(0.4)).toBe(0);
    expect(c.advance(0.6)).toBe(1);
    expect(c.advance(1.6)).toBe(2);
    expect(c.advance(1.6)).toBe(0);
  });

  test("standing still or a respawn (distance going back) fires nothing", () => {
    const c = createFootstepCadence(0.5);
    c.advance(0.45);
    expect(c.advance(0.1)).toBe(0);
    expect(c.advance(0.55)).toBe(0); // carry restarted at the respawn
    expect(c.advance(0.7)).toBe(1);
  });

  test("reset aligns to the current distance", () => {
    const c = createFootstepCadence(1);
    c.reset(10);
    expect(c.advance(10.5)).toBe(0);
    expect(c.advance(11)).toBe(1);
    expect(STRIDE_METRES).toBeGreaterThan(0);
    expect(() => createFootstepCadence(0)).toThrow();
  });
});
