import { describe, expect, test } from "bun:test";
import { RepaintThrottle } from "./screenPaint.ts";
import { ScreenTextures } from "./screenTextures.ts";

function fakeCanvas() {
  const ctx = {
    fillStyle: "",
    font: "",
    textBaseline: "top",
    fillRect() {},
    fillText() {},
  };
  return { width: 256, height: 160, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

describe("ScreenTextures", () => {
  test("repaints through the throttle and flags texture uploads", () => {
    const textures = new ScreenTextures({
      createCanvas: fakeCanvas,
      throttle: new RepaintThrottle(500),
    });
    const tex = textures.texture("a1");
    const version = tex.version;
    textures.setText("a1", "hello");
    expect(textures.flush(0)).toBe(1);
    expect(tex.version).toBeGreaterThan(version);
    textures.setText("a1", "again");
    expect(textures.flush(100)).toBe(0);
    expect(textures.flush(600)).toBe(1);
    expect(textures.paints).toBe(2);
  });

  test("retain disposes textures of henchmen that left", () => {
    const textures = new ScreenTextures({ createCanvas: fakeCanvas });
    let disposed = 0;
    textures.texture("a1").addEventListener("dispose", () => {
      disposed += 1;
    });
    textures.texture("a2");
    textures.retain(new Set(["a2"]));
    expect(textures.size).toBe(1);
    expect(disposed).toBe(1);
    textures.dispose();
    expect(textures.size).toBe(0);
  });
});
