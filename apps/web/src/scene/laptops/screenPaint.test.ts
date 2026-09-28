import { describe, expect, test } from "bun:test";
import {
  type Paintable,
  paintScreen,
  RepaintThrottle,
  SCREEN_COLORS,
  SCREEN_REPAINT_MS,
} from "./screenPaint.ts";

class Recorder implements Paintable {
  fillStyle: Paintable["fillStyle"] = "";
  font = "";
  textBaseline: CanvasTextBaseline = "alphabetic";
  readonly rects: string[] = [];
  readonly texts: string[] = [];
  fillRect() {
    this.rects.push(String(this.fillStyle));
  }
  fillText(text: string) {
    this.texts.push(text);
  }
}

describe("paintScreen", () => {
  test("null paints a dark, switched-off screen", () => {
    const ctx = new Recorder();
    paintScreen(ctx, null);
    expect(ctx.rects).toEqual([SCREEN_COLORS.off]);
    expect(ctx.texts).toEqual([]);
  });

  test("text paints non-blank lines, last 45 only", () => {
    const ctx = new Recorder();
    const lines = Array.from({ length: 60 }, (_, i) => (i % 2 ? "" : `line ${i}`));
    paintScreen(ctx, lines.join("\n"));
    expect(ctx.rects).toEqual([SCREEN_COLORS.background]);
    expect(ctx.texts[0]).toBe("line 16");
    expect(ctx.texts.at(-1)).toBe("line 58");
  });
});

describe("RepaintThrottle (~2 fps per laptop)", () => {
  test("at most one repaint per interval, newest text wins", () => {
    const t = new RepaintThrottle();
    t.submit("a", "1");
    expect(t.take(0)).toEqual([["a", "1"]]);
    t.submit("a", "2");
    t.submit("a", "3");
    expect(t.take(SCREEN_REPAINT_MS - 1)).toEqual([]);
    expect(t.take(SCREEN_REPAINT_MS)).toEqual([["a", "3"]]);
    expect(t.take(SCREEN_REPAINT_MS * 3)).toEqual([]);
  });

  test("a stream of changes at 60 Hz for 5 s paints ~10 times per laptop", () => {
    const t = new RepaintThrottle();
    const paints = new Map<string, number>();
    for (let ms = 0; ms < 5000; ms += 1000 / 60) {
      for (const id of ["a", "b", "c"]) t.submit(id, `text ${ms}`);
      for (const [id] of t.take(ms)) paints.set(id, (paints.get(id) ?? 0) + 1);
    }
    for (const id of ["a", "b", "c"]) {
      expect(paints.get(id)).toBeGreaterThanOrEqual(9);
      expect(paints.get(id)).toBeLessThanOrEqual(10);
    }
  });

  test("forget drops pending work", () => {
    const t = new RepaintThrottle();
    t.submit("a", "x");
    t.forget("a");
    expect(t.pendingCount).toBe(0);
  });
});
