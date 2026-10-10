import { describe, expect, test } from "bun:test";
import {
  afterCup,
  BUZZ_MS,
  BUZZ_SPEED_BOOST,
  buzzLeftMs,
  buzzSpeedBoost,
  COFFEE_REACH,
  COFFEE_SERVER_REACH,
  hasJitters,
  isBuzzed,
  JITTER_CUPS,
  MAX_CUPS,
} from "./coffee.ts";
import { parseClientCommand } from "./commands/index.ts";

describe("coffee buzz", () => {
  test("a cup buzzes for a minute; each cup starts the minute again", () => {
    const first = afterCup({ cups: 0, buzzUntil: 0 }, 1000);
    expect(first).toEqual({ cups: 1, buzzUntil: 1000 + BUZZ_MS });
    expect(afterCup(first, 31_000)).toEqual({ cups: 2, buzzUntil: 31_000 + BUZZ_MS });
    expect(BUZZ_MS).toBe(60_000);
  });

  test("cups stop counting at the maximum", () => {
    let buzz = { cups: 0, buzzUntil: 0 };
    for (let i = 0; i < MAX_CUPS + 3; i++) buzz = afterCup(buzz, i);
    expect(buzz.cups).toBe(MAX_CUPS);
  });

  test("buzzed from the first cup, jitters from the third", () => {
    expect(isBuzzed({ cups: 0 })).toBe(false);
    expect(isBuzzed({ cups: 1 })).toBe(true);
    expect(isBuzzed(null)).toBe(false);
    expect(JITTER_CUPS).toBe(3);
    expect(hasJitters({ cups: 2 })).toBe(false);
    expect(hasJitters({ cups: 3 })).toBe(true);
    expect(hasJitters(undefined)).toBe(false);
  });

  test("one modest speed factor, whatever the cups", () => {
    expect(buzzSpeedBoost({ cups: 0 })).toBe(1);
    expect(buzzSpeedBoost({ cups: 1 })).toBe(BUZZ_SPEED_BOOST);
    expect(buzzSpeedBoost({ cups: MAX_CUPS })).toBe(BUZZ_SPEED_BOOST);
    expect(BUZZ_SPEED_BOOST).toBeGreaterThan(1);
    expect(BUZZ_SPEED_BOOST).toBeLessThanOrEqual(1.5);
  });

  test("time left is clamped to the buzz's own length", () => {
    const buzz = { cups: 1, buzzUntil: 100_000 };
    expect(buzzLeftMs(buzz, 70_000)).toBe(30_000);
    expect(buzzLeftMs(buzz, 0)).toBe(BUZZ_MS);
    expect(buzzLeftMs(buzz, 200_000)).toBe(0);
    expect(buzzLeftMs({ cups: 0, buzzUntil: 100_000 }, 70_000)).toBe(0);
    expect(buzzLeftMs(null, 0)).toBe(0);
  });

  test("the server's reach covers the client's", () => {
    expect(COFFEE_SERVER_REACH).toBeGreaterThan(COFFEE_REACH);
  });

  test("the command carries nothing: no speed, no cups, no time", () => {
    const parsed = parseClientCommand("coffee.drink", { cups: 9, speed: 3, buzzUntil: 1e15 });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ type: "coffee.drink" });
  });
});
