import { describe, expect, test } from "bun:test";
import {
  DECAL_HEIGHT_PX,
  DECAL_MAX_CHARS,
  DECAL_MAX_WIDTH_PX,
  type DecalCanvas,
  type DecalContext,
  decalKey,
  decalLines,
  decalWidthPx,
  drawNameDecal,
  nameDecalCacheSize,
  nameDecalTexture,
} from "./nameDecal.ts";

/** Records what the decal draws; text is 20 px per character. */
function recorder() {
  const calls: { text: string; font: string; y: number }[] = [];
  const ctx: DecalContext = {
    font: "",
    fillStyle: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    measureText: (text) => ({ width: text.length * 20 }),
    clearRect: () => {},
    fillText(text, _x, y) {
      calls.push({ text, font: this.font, y });
    },
  };
  const canvas: DecalCanvas = { width: 0, height: 0, getContext: () => ctx };
  return { canvas, calls };
}

describe("name decal", () => {
  test("lines are trimmed, capped and never empty", () => {
    expect(decalLines("  Ada ", " opus ")).toEqual({ name: "Ada", model: "opus" });
    expect(decalLines("", "gpt-5-codex").name).toBe("?");
    const long = decalLines("x".repeat(DECAL_MAX_CHARS + 5), "m");
    expect(long.name).toHaveLength(DECAL_MAX_CHARS);
    expect(long.name.endsWith("…")).toBe(true);
    expect(decalKey(" Ada", "opus")).toBe(decalKey("Ada", "opus "));
  });

  test("draws the owner name large and bold, the model below it", () => {
    const { canvas, calls } = recorder();
    const aspect = drawNameDecal(canvas, { name: "Ante", model: "claude-opus" });
    expect(calls.map((c) => c.text)).toEqual(["Ante", "claude-opus"]);
    expect(calls[0]?.font).toMatch(/^800 /);
    expect(calls[1]?.y).toBeGreaterThan(calls[0]?.y ?? 0);
    expect(canvas.height).toBe(DECAL_HEIGHT_PX);
    // The wider line (the model, 11 chars) sets the width.
    expect(canvas.width).toBe(decalWidthPx(11 * 20));
    expect(aspect).toBeCloseTo(canvas.width / canvas.height, 6);
  });

  test("width is padded, a multiple of 8 and capped", () => {
    expect(decalWidthPx(100) % 8).toBe(0);
    expect(decalWidthPx(100)).toBeGreaterThan(100);
    expect(decalWidthPx(10_000)).toBe(DECAL_MAX_WIDTH_PX);
  });

  test("textures are cached per owner and model; no DOM means no texture", () => {
    expect(nameDecalTexture("Ante", "opus", () => null)).toBeNull();
    const a = nameDecalTexture("Ante", "opus", () => recorder().canvas);
    const b = nameDecalTexture("Ante ", "opus", () => recorder().canvas);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(nameDecalTexture("Mia", "opus", () => recorder().canvas)).not.toBe(a);
    expect(nameDecalCacheSize()).toBe(2);
  });
});
