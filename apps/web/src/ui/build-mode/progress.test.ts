import { describe, expect, test } from "bun:test";
import { buildProgress, formatRemaining } from "./progress.ts";

describe("build progress", () => {
  test("counts down from when the room was first seen building", () => {
    const start = 1_000_000;
    const ends = start + 20_000;
    expect(buildProgress("r1", ends, start)).toEqual({ remainingMs: 20_000, fraction: 0 });
    expect(buildProgress("r1", ends, start + 5_000).fraction).toBeCloseTo(0.25);
    expect(buildProgress("r1", ends, start + 25_000)).toEqual({ remainingMs: 0, fraction: 1 });
    // Ready: done, and the next build starts afresh.
    expect(buildProgress("r1", 0, start, false).fraction).toBe(1);
    expect(buildProgress("r1", ends + 60_000, start + 30_000).fraction).toBe(0);
  });

  test("time left in minutes and seconds", () => {
    expect(formatRemaining(14_200)).toBe("0:15");
    expect(formatRemaining(75_000)).toBe("1:15");
    expect(formatRemaining(0)).toBe("finishing");
  });
});
