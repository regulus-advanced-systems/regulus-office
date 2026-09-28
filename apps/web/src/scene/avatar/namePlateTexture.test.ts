import { describe, expect, test } from "bun:test";
import {
  HUMAN_PLATE_STYLE,
  namePlateKey,
  PLATE_MAX_CHARS,
  PLATE_PAD_PX,
  plateLabel,
  plateWidthPx,
} from "./namePlateTexture.ts";

describe("namePlateTexture", () => {
  test("labels are trimmed, never empty and capped in length", () => {
    expect(plateLabel("  Ada  ")).toBe("Ada");
    expect(plateLabel("   ")).toBe("?");
    const long = "x".repeat(PLATE_MAX_CHARS + 10);
    expect(plateLabel(long)).toHaveLength(PLATE_MAX_CHARS);
    expect(plateLabel(long).endsWith("…")).toBe(true);
  });

  test("texture width pads the text and is a multiple of 8", () => {
    expect(plateWidthPx(100)).toBe(Math.ceil((100 + PLATE_PAD_PX * 2) / 8) * 8);
    expect(plateWidthPx(1) % 8).toBe(0);
  });

  test("cache key depends on the label and the style", () => {
    expect(namePlateKey(" Ada ", HUMAN_PLATE_STYLE)).toBe(namePlateKey("Ada", HUMAN_PLATE_STYLE));
    expect(namePlateKey("Ada", HUMAN_PLATE_STYLE)).not.toBe(
      namePlateKey("Ada", { ...HUMAN_PLATE_STYLE, border: "#000000" }),
    );
  });
});
