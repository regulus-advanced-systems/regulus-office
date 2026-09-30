import { describe, expect, test } from "bun:test";
import { MINE, NOW, OFFICE } from "./fixtures.ts";
import { buildUsageModel, formatDuration, limitTone } from "./model.ts";

describe("usage model", () => {
  test("own windows with tones and countdowns, spend, office and leaderboard", () => {
    const m = buildUsageModel(MINE, OFFICE, NOW);
    expect(m.limits).toEqual([
      {
        key: "claude-code:five_hour",
        label: "Claude · 5-hour",
        pct: 72.4,
        tone: "warn",
        detail: "resets in 2h 10m",
      },
      { key: "codex:seven_day", label: "Codex · Weekly", pct: 0, tone: "ok", detail: "reset" },
    ]);
    expect(m.myTodayUsd).toBe("$3.46");
    expect(m.myTodayTokens).toBe("41.5K");
    expect(m.my7dUsd).toBe("$21.00");
    expect(m.officeTodayUsd).toBe("$42.50");
    expect(m.officeTodayTokens).toBe("1M");
    expect(m.top).toEqual([{ key: "a1", name: "Ada's Codex robot", owner: "Ada", tokens: "900K" }]);
  });

  test("before anything loaded", () => {
    const m = buildUsageModel(null, null, NOW);
    expect(m.mineLoaded).toBe(false);
    expect(m.limits).toEqual([]);
    expect(m.myTodayUsd).toBe("$0.00");
  });

  test("helpers", () => {
    expect(limitTone(69)).toBe("ok");
    expect(limitTone(70)).toBe("warn");
    expect(limitTone(95)).toBe("high");
    expect(formatDuration(30_000)).toBe("1m");
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe("3d 4h");
  });
});
