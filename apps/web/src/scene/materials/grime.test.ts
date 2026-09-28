import { describe, expect, test } from "bun:test";
import { createGrimeTexture, GRIME_STRENGTH, grimePixels, mulberry32 } from "./grime.ts";

describe("mulberry32", () => {
  test("is deterministic and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("grimePixels", () => {
  test("darkens by at most the strength and is opaque", () => {
    const size = 32;
    const strength = 0.12;
    const px = grimePixels(size, 3, strength);
    expect(px.length).toBe(size * size * 4);
    const floor = Math.floor(255 * (1 - strength));
    let min = 255;
    let max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const g = px[i] as number;
      expect(px[i + 1]).toBe(g);
      expect(px[i + 2]).toBe(g);
      expect(px[i + 3]).toBe(255);
      expect(g).toBeGreaterThanOrEqual(floor);
      min = Math.min(min, g);
      max = Math.max(max, g);
    }
    // Actually varies, and stays within the 10-15% band.
    expect(max - min).toBeGreaterThan(10);
    expect(min).toBeGreaterThanOrEqual(255 * (1 - 0.15) - 1);
    expect(GRIME_STRENGTH).toBeGreaterThanOrEqual(0.1);
    expect(GRIME_STRENGTH).toBeLessThanOrEqual(0.15);
  });

  test("same seed gives the same pixels", () => {
    expect(grimePixels(16, 9)).toEqual(grimePixels(16, 9));
    expect(grimePixels(16, 9)).not.toEqual(grimePixels(16, 10));
  });
});

describe("createGrimeTexture", () => {
  test("repeats and is sized as requested", () => {
    const tex = createGrimeTexture(16, 1);
    expect(tex.image.width).toBe(16);
    expect(tex.image.height).toBe(16);
    expect(tex.wrapS).toBe(tex.wrapT);
    expect(tex.version).toBeGreaterThan(0);
  });
});
