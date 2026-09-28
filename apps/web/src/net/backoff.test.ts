import { describe, expect, test } from "bun:test";
import { backoffDelay, backoffSchedule, DEFAULT_BACKOFF } from "./backoff.ts";

const noJitter = () => 0.5; // 2*0.5-1 = 0 spread

describe("backoff", () => {
  test("doubles from the base and caps at maxMs without jitter", () => {
    const opts = { baseMs: 500, maxMs: 30_000, factor: 2, jitter: 0.3 };
    expect(backoffSchedule(8, opts, noJitter)).toEqual([
      500, 1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  test("jitter stays within +/- jitter fraction of the raw delay", () => {
    const opts = { ...DEFAULT_BACKOFF, jitter: 0.3 };
    expect(backoffDelay(2, opts, () => 0)).toBe(1400); // 2000 * 0.7
    expect(backoffDelay(2, opts, () => 1)).toBe(2600); // 2000 * 1.3
    for (let i = 0; i < 200; i++) {
      const d = backoffDelay(3, opts);
      expect(d).toBeGreaterThanOrEqual(2800);
      expect(d).toBeLessThanOrEqual(5200);
    }
  });

  test("negative or fractional attempts are treated as the first attempt", () => {
    expect(backoffDelay(-3, DEFAULT_BACKOFF, noJitter)).toBe(500);
    expect(backoffDelay(0.9, DEFAULT_BACKOFF, noJitter)).toBe(500);
  });

  test("never returns a negative delay even with jitter of 1", () => {
    expect(backoffDelay(0, { ...DEFAULT_BACKOFF, jitter: 1 }, () => 0)).toBe(0);
  });
});
