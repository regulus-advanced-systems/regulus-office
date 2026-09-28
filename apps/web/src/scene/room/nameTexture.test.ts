import { describe, expect, test } from "bun:test";
import {
  createNameTexture,
  NAME_CANVAS_HEIGHT,
  NAME_CANVAS_MAX_WIDTH,
  nameCanvasSize,
  nameLayout,
} from "./nameTexture.ts";

describe("nameCanvasSize", () => {
  test("follows the plate aspect and caps the width", () => {
    expect(nameCanvasSize(10)).toEqual({
      width: NAME_CANVAS_HEIGHT * 10,
      height: NAME_CANVAS_HEIGHT,
    });
    expect(nameCanvasSize(14 / 0.4).width).toBe(3360);
    expect(nameCanvasSize(1000).width).toBe(NAME_CANVAS_MAX_WIDTH);
    expect(nameCanvasSize(0.1).width).toBe(NAME_CANVAS_HEIGHT);
    expect(nameCanvasSize(Number.NaN).width).toBe(NAME_CANVAS_HEIGHT);
  });

  test("layout scales with height", () => {
    const l = nameLayout(96);
    expect(l.fontPx).toBeLessThan(96);
    expect(l.inset).toBeGreaterThan(0);
  });
});

describe("createNameTexture", () => {
  test("returns null without a DOM", () => {
    expect(typeof document).toBe("undefined");
    expect(createNameTexture("Lobby", 35)).toBeNull();
  });
});
