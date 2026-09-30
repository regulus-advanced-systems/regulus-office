import { describe, expect, test } from "bun:test";
import { MINE, OFFICE } from "../../ui/usage/fixtures.ts";
import { buildUsageModel } from "../../ui/usage/model.ts";
import {
  clip,
  paintUsageScreen,
  USAGE_COLORS,
  USAGE_TEXTURE_SIZE,
  type UsagePaintable,
} from "./usagePaint.ts";
import { UsageTexture, variantForAnchor } from "./usageTexture.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");

class Recorder implements UsagePaintable {
  fillStyle: UsagePaintable["fillStyle"] = "";
  font = "";
  textAlign: CanvasTextAlign = "left";
  textBaseline: CanvasTextBaseline = "alphabetic";
  readonly rects: { color: string; x: number; y: number; w: number; h: number }[] = [];
  readonly texts: { text: string; x: number; y: number; color: string }[] = [];
  fillRect(x: number, y: number, w: number, h: number) {
    this.rects.push({ color: String(this.fillStyle), x, y, w, h });
  }
  fillText(text: string, x: number, y: number) {
    this.texts.push({ text, x, y, color: String(this.fillStyle) });
  }
}

describe("usage wall rendering", () => {
  test("the lobby wall draws own windows as bars, own spend, office totals and top robots", () => {
    const ctx = new Recorder();
    paintUsageScreen(ctx, buildUsageModel(MINE, OFFICE, NOW), "wall");
    const { width, height } = USAGE_TEXTURE_SIZE.wall;
    expect(ctx.rects[0]).toEqual({
      color: USAGE_COLORS.background,
      x: 0,
      y: 0,
      w: width,
      h: height,
    });
    const texts = ctx.texts.map((t) => t.text);
    expect(texts).toContain("USAGE TRACKER");
    expect(texts).toContain("Claude · 5-hour");
    expect(texts).toContain("72%");
    expect(texts).toContain("resets in 2h 10m");
    expect(texts).toContain("$3.46");
    expect(texts).toContain("$42.50");
    expect(texts).toContain("1. Ada's Codex robot");
    // The 72 % bar is amber (warn) and 72.4 % of its track; the reset window is empty.
    const warn = ctx.rects.find((r) => r.color === USAGE_COLORS.warn);
    const track = ctx.rects.filter((r) => r.color === USAGE_COLORS.track)[0];
    expect(warn && track && warn.w / track.w).toBeCloseTo(0.724, 3);
    // Everything stays on the texture.
    for (const t of ctx.texts) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(width);
      expect(t.y).toBeLessThan(height);
    }
  });

  test("the compact room screen: own windows and spend, one office line", () => {
    const ctx = new Recorder();
    paintUsageScreen(ctx, buildUsageModel(MINE, OFFICE, NOW), "compact");
    const texts = ctx.texts.map((t) => t.text);
    expect(texts).toContain("USAGE");
    expect(texts).toContain("$3.46");
    expect(texts).not.toContain("1. Ada's Codex robot");
    expect(texts.some((t) => t.startsWith("office today $42.50"))).toBe(true);
    const { height } = USAGE_TEXTURE_SIZE.compact;
    for (const t of ctx.texts) expect(t.y).toBeLessThan(height);
  });

  test("signed out: an invitation instead of windows", () => {
    const ctx = new Recorder();
    paintUsageScreen(ctx, buildUsageModel(null, OFFICE, NOW), "compact");
    expect(ctx.texts.map((t) => t.text)).toContain("Sign in to see your windows");
  });

  test("clip and variants", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
    expect(variantForAnchor(3)).toBe("wall");
    expect(variantForAnchor(1.4)).toBe("compact");
  });
});

describe("UsageTexture", () => {
  test("repaints and uploads only when the picture changes", () => {
    const ctx = new Recorder();
    const canvas = (w: number, h: number) =>
      ({ width: w, height: h, getContext: () => ctx }) as unknown as HTMLCanvasElement;
    const screen = new UsageTexture("wall", canvas);
    const version = screen.texture.version;
    const model = buildUsageModel(MINE, OFFICE, NOW);
    expect(screen.update(model)).toBe(true);
    expect(screen.texture.version).toBeGreaterThan(version);
    expect(screen.update(buildUsageModel(MINE, OFFICE, NOW))).toBe(false);
    expect(screen.update(buildUsageModel(MINE, { ...OFFICE, activeHumans: 4 }, NOW))).toBe(true);
    expect(screen.paints).toBe(2);
    screen.dispose();
  });
});
