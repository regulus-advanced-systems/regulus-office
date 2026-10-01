import { describe, expect, test } from "bun:test";
import { JUKEBOX_SYNC } from "@regulus/protocol";
import { correctDrift, youtubeNeedsSeek } from "./drift.ts";

const { settleMs, nudgeMaxMs, nudgeRate } = JUKEBOX_SYNC;

describe("correctDrift: nudge versus re-seek", () => {
  test("a few ms off plays on at normal speed", () => {
    expect(correctDrift(0, 1)).toEqual({ kind: "settle", rate: 1 });
    expect(correctDrift(settleMs, 1)).toEqual({ kind: "settle", rate: 1 });
    expect(correctDrift(-settleMs, 1)).toEqual({ kind: "settle", rate: 1 });
  });

  test("ahead by up to the nudge limit slows down a little; behind speeds up", () => {
    expect(correctDrift(40, 1)).toEqual({ kind: "nudge", rate: 1 - nudgeRate });
    expect(correctDrift(-40, 1)).toEqual({ kind: "nudge", rate: 1 + nudgeRate });
    expect(correctDrift(nudgeMaxMs, 1).kind).toBe("nudge");
    expect(correctDrift(-nudgeMaxMs, 1).kind).toBe("nudge");
  });

  test("beyond the nudge limit (research 01 §5: 75 ms) it re-seeks", () => {
    expect(nudgeMaxMs).toBe(75);
    expect(correctDrift(nudgeMaxMs + 1, 1)).toEqual({ kind: "seek", rate: 1 });
    expect(correctDrift(-2_000, 1 + nudgeRate)).toEqual({ kind: "seek", rate: 1 });
    expect(correctDrift(Number.NaN, 1).kind).toBe("seek");
  });

  test("the nudge is inaudible: well under 1 % speed", () => {
    expect(nudgeRate).toBeGreaterThanOrEqual(0.003);
    expect(nudgeRate).toBeLessThanOrEqual(0.005);
  });

  test("hysteresis: once nudging it keeps going down to half the settle band", () => {
    const nudging = 1 - nudgeRate;
    expect(correctDrift(settleMs - 1, nudging).kind).toBe("nudge");
    expect(correctDrift(settleMs / 2, nudging)).toEqual({ kind: "settle", rate: 1 });
    // A player that overshot is turned round, not left at the old rate.
    expect(correctDrift(-30, nudging)).toEqual({ kind: "nudge", rate: 1 + nudgeRate });
  });

  test("a nudge closes a 60 ms gap within a quarter of a minute without a seek", () => {
    let drift = 60;
    let rate = 1;
    let seconds = 0;
    while (seconds < 60) {
      const fix = correctDrift(drift, rate);
      expect(fix.kind).not.toBe("seek");
      rate = fix.rate;
      if (fix.kind === "settle") break;
      drift += (rate - 1) * 250; // a check every 250 ms
      seconds += 0.25;
    }
    expect(Math.abs(drift)).toBeLessThanOrEqual(settleMs);
    expect(seconds).toBeLessThan(15);
  });
});

describe("youtubeNeedsSeek (loose sync)", () => {
  test("only beyond two seconds", () => {
    expect(youtubeNeedsSeek(1_500)).toBe(false);
    expect(youtubeNeedsSeek(-1_999)).toBe(false);
    expect(youtubeNeedsSeek(2_001)).toBe(true);
    expect(youtubeNeedsSeek(Number.NaN)).toBe(true);
  });
});
