import { describe, expect, test } from "bun:test";
import { createDingGate, DING_MIN_INTERVAL_MS, playDing } from "./ding.ts";

describe("robot ding", () => {
  test("muted by volume 0 and by reduced motion", () => {
    const gate = createDingGate();
    expect(gate({ now: 0, volume: 0, reducedMotion: false })).toBe(false);
    expect(gate({ now: 0, volume: 0.8, reducedMotion: true })).toBe(false);
    expect(gate({ now: 0, volume: 0.8, reducedMotion: false })).toBe(true);
  });

  test("rate-limited", () => {
    const gate = createDingGate();
    const on = { volume: 1, reducedMotion: false };
    expect(gate({ ...on, now: 1000 })).toBe(true);
    expect(gate({ ...on, now: 1000 + DING_MIN_INTERVAL_MS - 1 })).toBe(false);
    expect(gate({ ...on, now: 1000 + DING_MIN_INTERVAL_MS })).toBe(true);
  });

  test("playing without WebAudio is a no-op", () => {
    expect(() => playDing(1)).not.toThrow();
  });
});
