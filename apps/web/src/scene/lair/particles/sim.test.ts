import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../../materials/grime.ts";
import {
  createPool,
  dustAlpha,
  lifeFraction,
  SPARKS_PER_BURST,
  seedDust,
  softDotPixels,
  sparkColor,
  stepDust,
  stepSparks,
} from "./sim.ts";

const alive = (life: Float32Array) => [...life].filter((l) => l > 0).length;

describe("sparks", () => {
  test("a burst revives sparks at the torch, flying up and out", () => {
    const pool = createPool(40);
    stepSparks(pool, 0.016, mulberry32(1), [1, 2, 3]);
    expect(alive(pool.life)).toBe(SPARKS_PER_BURST);
    const i = [...pool.life].findIndex((l) => l > 0);
    expect([pool.pos[i * 3], pool.pos[i * 3 + 1], pool.pos[i * 3 + 2]]).toEqual([1, 2, 3]);
    expect(pool.vel[i * 3 + 1] ?? 0).toBeGreaterThan(0);
  });

  test("sparks fall, bounce off the floor and die", () => {
    const pool = createPool(20);
    const rand = mulberry32(2);
    stepSparks(pool, 0.016, rand, [0, 1, 0]);
    let minY = Infinity;
    for (let k = 0; k < 120; k++) {
      pool.nextBurst = 99; // no new bursts
      stepSparks(pool, 1 / 60, rand, [0, 1, 0]);
      for (let i = 0; i < pool.count; i++)
        if ((pool.life[i] ?? 0) > 0) minY = Math.min(minY, pool.pos[i * 3 + 1] ?? 0);
    }
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(alive(pool.life)).toBe(0);
  });

  test("never more alive than the pool holds", () => {
    const pool = createPool(25);
    const rand = mulberry32(3);
    for (let k = 0; k < 600; k++) stepSparks(pool, 1 / 60, rand, [0, 1, 0]);
    expect(alive(pool.life)).toBeLessThanOrEqual(25);
    expect(alive(pool.life)).toBeGreaterThan(0);
  });

  test("they cool from white-yellow to dark", () => {
    const hot = sparkColor(1);
    const cold = sparkColor(0);
    expect(hot[1]).toBeGreaterThan(0.9);
    expect(cold[1]).toBe(0);
    expect(cold[2]).toBe(0);
    expect(lifeFraction(createPool(1), 0)).toBe(0);
  });
});

describe("dust", () => {
  const box = { center: [0, 1, 0] as const, size: [4, 2, 4] as const };

  test("motes stay in the box as they drift", () => {
    const pool = createPool(50);
    const rand = mulberry32(4);
    seedDust(pool, rand, box);
    for (let k = 0; k < 600; k++) stepDust(pool, 1 / 30, k / 30, rand, box);
    for (let i = 0; i < pool.count; i++) {
      expect(Math.abs((pool.pos[i * 3] ?? 0) - 0)).toBeLessThan(2.6);
      expect(pool.pos[i * 3 + 1] ?? 0).toBeGreaterThanOrEqual(-0.01);
      expect(pool.pos[i * 3 + 1] ?? 0).toBeLessThanOrEqual(2.01);
    }
  });

  test("fade in and out over their life", () => {
    expect(dustAlpha(0)).toBeCloseTo(0);
    expect(dustAlpha(1)).toBeCloseTo(0);
    expect(dustAlpha(0.5)).toBeCloseTo(1);
  });
});

test("the sprite is opaque in the middle and clear at the rim", () => {
  const px = softDotPixels(16);
  const alpha = (x: number, y: number) => px[(y * 16 + x) * 4 + 3] ?? 0;
  expect(alpha(8, 8)).toBeGreaterThan(200);
  expect(alpha(0, 0)).toBe(0);
});
