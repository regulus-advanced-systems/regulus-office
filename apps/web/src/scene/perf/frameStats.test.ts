import { describe, expect, test } from "bun:test";
import { percentile, Ring, summarise, textureBytes, textureMemory } from "./frameStats.ts";

describe("frame statistics (#190)", () => {
  test("nearest-rank percentiles", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 90)).toBe(90);
    expect(percentile(v, 99)).toBe(99);
    expect(percentile(v, 100)).toBe(100);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 99)).toBe(7);
  });

  test("the ring keeps the newest values", () => {
    const r = new Ring(3);
    for (const v of [1, 2, 3, 4, 5]) r.push(v);
    expect(r.values().sort()).toEqual([3, 4, 5]);
    r.clear();
    expect(r.values()).toEqual([]);
  });

  test("a summary of steady 60 fps with one hitch", () => {
    const intervals = [...Array.from({ length: 99 }, () => 16.67), 50];
    const s = summarise(intervals, [2, 3, 4]);
    expect(s.frames).toBe(100);
    expect(s.p50).toBe(16.67);
    expect(s.p99).toBe(16.67);
    expect(s.max).toBe(50);
    expect(s.fps).toBeGreaterThan(58);
    expect(s.fps).toBeLessThan(60);
    expect(s.cpuP50).toBe(3);
  });

  test("texture memory counts each texture once, with its mip chain", () => {
    const canvas = { uuid: "a", isTexture: true, image: { width: 256, height: 128 } };
    const flat = {
      uuid: "b",
      isTexture: true,
      generateMipmaps: false,
      image: { width: 18, height: 1 },
    };
    expect(textureBytes(canvas)).toBe(Math.round((256 * 128 * 4 * 4) / 3));
    expect(textureBytes(flat)).toBe(18 * 4);
    const m = textureMemory([
      { map: canvas, gradientMap: flat },
      { map: canvas, uniforms: { tex: { value: flat } } },
      { color: 3 },
    ]);
    expect(m.count).toBe(2);
    expect(m.bytes).toBe(textureBytes(canvas) + textureBytes(flat));
  });
});
