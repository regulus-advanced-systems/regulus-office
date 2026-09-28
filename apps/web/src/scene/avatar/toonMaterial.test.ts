import { describe, expect, test } from "bun:test";
import {
  getGradientMap,
  materialCacheSize,
  normalizeHex,
  TOON_STEPS,
  toonMaterialFor,
  toonRampValues,
  unlitMaterialFor,
} from "./toonMaterial.ts";

describe("toonMaterial", () => {
  test("ramp has 3-4 ascending steps that never reach black", () => {
    expect(TOON_STEPS).toBeGreaterThanOrEqual(3);
    expect(TOON_STEPS).toBeLessThanOrEqual(4);
    const ramp = toonRampValues();
    expect(ramp).toHaveLength(TOON_STEPS);
    expect(ramp[0]).toBeGreaterThan(64);
    expect(ramp[ramp.length - 1]).toBe(255);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThan(ramp[i - 1] as number);
  });

  test("gradient map is a shared 1D nearest-filtered texture", () => {
    const map = getGradientMap();
    expect(getGradientMap()).toBe(map);
    expect(map.image.width).toBe(TOON_STEPS);
    expect(map.image.height).toBe(1);
    expect(map.minFilter).toBe(map.magFilter);
  });

  test("materials are cached per normalised colour and use the ramp", () => {
    const before = materialCacheSize();
    const a = toonMaterialFor("#2A9D8F");
    const b = toonMaterialFor("#2a9d8f");
    expect(a).toBe(b);
    expect(a.gradientMap).toBe(getGradientMap());
    expect(a.type).toBe("MeshToonMaterial");
    expect(toonMaterialFor("#B5773C")).not.toBe(a);
    expect(materialCacheSize()).toBe(before + 2);
    expect(unlitMaterialFor("#F5A623")).toBe(unlitMaterialFor("#f5a623"));
    expect(normalizeHex("#FFF")).toBe("#ffffff");
  });
});
