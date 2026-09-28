import { describe, expect, test } from "bun:test";
import { createPoseBuffer, INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS } from "./remoteInterpolation.ts";

describe("remote pose buffer", () => {
  test("holds the first sample before enough history exists", () => {
    const b = createPoseBuffer();
    expect(b.sampleAt(0)).toBeNull();
    b.push({ t: 0, x: 1, z: 2, heading: 0.5 });
    expect(b.sampleAt(0)).toEqual({ x: 1, z: 2, heading: 0.5, moving: false });
    expect(b.sampleAt(500)).toEqual({ x: 1, z: 2, heading: 0.5, moving: false });
  });

  test("interpolates between the two samples around the delayed render time", () => {
    const b = createPoseBuffer({ delayMs: 100 });
    b.push({ t: 0, x: 0, z: 0, heading: 0 });
    b.push({ t: 50, x: 1, z: 0, heading: 0 });
    b.push({ t: 100, x: 2, z: 0, heading: 1 });
    const p = b.sampleAt(175); // render time 75: halfway between t=50 and t=100
    expect(p?.x).toBeCloseTo(1.5);
    expect(p?.heading).toBeCloseTo(0.5);
    expect(p?.moving).toBe(true);
  });

  test("extrapolates briefly along the last velocity, then holds", () => {
    const b = createPoseBuffer({ delayMs: 0, maxExtrapolationMs: 100 });
    b.push({ t: 0, x: 0, z: 0, heading: 0 });
    b.push({ t: 50, x: 1, z: 0, heading: 0 });
    expect(b.sampleAt(100)?.x).toBeCloseTo(2);
    expect(b.sampleAt(100)?.moving).toBe(true);
    const held = b.sampleAt(1000);
    expect(held?.x).toBeCloseTo(3);
    expect(held?.moving).toBe(false);
  });

  test("a standing human reads as not moving even while patches keep arriving", () => {
    const b = createPoseBuffer({ delayMs: 100 });
    for (let t = 0; t <= 300; t += 50) b.push({ t, x: 3, z: 3, heading: 1 });
    expect(b.sampleAt(275)).toEqual({ x: 3, z: 3, heading: 1, moving: false });
  });

  test("a move after a long silence lerps over one patch interval, not the silence", () => {
    const b = createPoseBuffer({ delayMs: 0 });
    b.push({ t: 0, x: 0, z: 0, heading: 0 });
    b.push({ t: 5000, x: 1, z: 0, heading: 0 });
    expect(b.sampleAt(4900)?.x).toBeCloseTo(0);
    expect(b.sampleAt(4975)?.x).toBeCloseTo(0.5);
    expect(b.sampleAt(5000)?.x).toBeCloseTo(1);
  });

  test("ignores out-of-order samples and trims history it no longer needs", () => {
    const b = createPoseBuffer({ delayMs: 0 });
    for (let t = 0; t < 1000; t += 50) b.push({ t, x: t / 100, z: 0, heading: 0 });
    b.push({ t: 10, x: 99, z: 0, heading: 0 });
    b.sampleAt(900);
    expect(b.size).toBeLessThanOrEqual(4);
    expect(b.sampleAt(900)?.x).toBeCloseTo(9);
  });

  test("defaults render two patches behind and extrapolate no longer than the cap", () => {
    expect(INTERP_DELAY_MS).toBe(100);
    expect(MAX_EXTRAPOLATION_MS).toBeGreaterThan(0);
  });
});
