import { describe, expect, test } from "bun:test";
import { formatClock, formatCompact, formatUsd, msUntilNextMinute } from "./format.ts";

describe("formatClock", () => {
  const at = new Date(Date.UTC(2026, 8, 28, 14, 5, 42));
  test("24-hour by default, no seconds", () => {
    expect(formatClock(at, { timeZone: "UTC" })).toBe("14:05");
  });
  test("12-hour when asked", () => {
    expect(formatClock(at, { locale: "en-US", hour12: true, timeZone: "UTC" })).toMatch(
      /^0?2:05\s?PM$/i,
    );
  });
  test("msUntilNextMinute counts to the next whole minute", () => {
    expect(msUntilNextMinute(60_000 * 3 + 15_000)).toBe(45_000);
    expect(msUntilNextMinute(120_000)).toBe(60_000);
  });
});

describe("formatCompact", () => {
  test("keeps small numbers, abbreviates thousands and millions", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(950)).toBe("950");
    expect(formatCompact(93_700)).toBe("93.7K");
    expect(formatCompact(4_300_000)).toBe("4.3M");
    expect(formatCompact(1_000)).toBe("1K");
    expect(formatCompact(123_456)).toBe("123K");
    expect(formatCompact(2.5e9)).toBe("2.5B");
  });
  test("is defensive about bad input", () => {
    expect(formatCompact(-5)).toBe("0");
    expect(formatCompact(Number.NaN)).toBe("0");
  });
});

describe("formatUsd", () => {
  test("cents below 1000, compact above", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12.4)).toBe("$12.40");
    expect(formatUsd(1234)).toBe("$1.2K");
    expect(formatUsd(-1)).toBe("$0.00");
  });
});
