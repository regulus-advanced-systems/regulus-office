import { describe, expect, test } from "bun:test";
import { FpsCounter, statsEnabled } from "./stats.ts";

describe("statsEnabled", () => {
  test("only with the ?stats flag", () => {
    expect(statsEnabled("?stats")).toBe(true);
    expect(statsEnabled("?foo=1&stats=1")).toBe(true);
    expect(statsEnabled("")).toBe(false);
    expect(statsEnabled("?statistics")).toBe(false);
  });
});

describe("FpsCounter", () => {
  test("reports frames per second once a window has elapsed", () => {
    const c = new FpsCounter(1000);
    let t = 0;
    c.tick(t);
    for (let i = 0; i < 60; i++) {
      t += 1000 / 60;
      c.tick(t);
    }
    expect(c.fps).toBeCloseTo(60, 0);
    // A slower second updates the value.
    for (let i = 0; i < 30; i++) {
      t += 1000 / 30;
      c.tick(t);
    }
    expect(c.fps).toBeCloseTo(30, 0);
  });

  test("is zero before the first window completes", () => {
    const c = new FpsCounter(1000);
    expect(c.tick(0)).toBe(0);
    expect(c.tick(500)).toBe(0);
  });
});
