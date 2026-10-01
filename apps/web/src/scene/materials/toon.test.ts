import { describe, expect, test } from "bun:test";
import { PALETTES } from "@regulus/room-layout";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
} from "three";
import {
  createGradientMap,
  createToonMaterial,
  darken,
  gradientRampBytes,
  restyleColor,
  sharedToonRamp,
  TOON_DARKEST,
  TOON_STEPS,
  toonFromMaterial,
  toonifyObject,
} from "./toon.ts";

const palette = PALETTES[0];
if (!palette) throw new Error("no palettes");

describe("gradientRampBytes", () => {
  test("default ramp has 4 evenly spaced steps ending at full brightness", () => {
    const ramp = gradientRampBytes();
    expect(ramp.length).toBe(TOON_STEPS);
    expect(ramp[0]).toBe(Math.round(255 * TOON_DARKEST));
    expect(ramp[ramp.length - 1]).toBe(255);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThan(ramp[i - 1] as number);
    const step = (ramp[1] as number) - (ramp[0] as number);
    expect(Math.abs((ramp[2] as number) - (ramp[1] as number) - step)).toBeLessThanOrEqual(1);
  });

  test("three-step ramp is also supported; fewer than 2 is clamped", () => {
    expect(gradientRampBytes(3).length).toBe(3);
    expect(gradientRampBytes(1).length).toBe(2);
  });
});

describe("createGradientMap", () => {
  test("is a 1-row nearest-filtered texture", () => {
    const tex = createGradientMap(3);
    expect(tex.image.width).toBe(3);
    expect(tex.image.height).toBe(1);
    expect(tex.magFilter).toBe(NearestFilter);
    expect(tex.minFilter).toBe(NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
  });

  test("sharedToonRamp returns one instance", () => {
    expect(sharedToonRamp()).toBe(sharedToonRamp());
  });
});

describe("createToonMaterial", () => {
  test("uses the shared ramp, no specular, given colour", () => {
    const m = createToonMaterial("#30B090");
    expect(m).toBeInstanceOf(MeshToonMaterial);
    expect(m.gradientMap).toBe(sharedToonRamp());
    expect(m.color.getHexString()).toBe("30b090");
    expect(m.transparent).toBe(false);
  });
});

describe("restyleColor", () => {
  test("maps Kenney wood to the palette accent and leaves metal alone", () => {
    expect(restyleColor("wood", palette)).toBe(palette.accent);
    expect(restyleColor("woodDark", palette)).toBe(darken(palette.accent, 0.8));
    expect(restyleColor("metal", palette)).toBeUndefined();
    expect(restyleColor("carpet", palette)).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test("darken scales channels", () => {
    expect(darken("#ffffff", 0.5)).toBe("#808080");
    expect(darken("#000000", 0.5)).toBe("#000000");
  });
});

describe("toonifyObject", () => {
  test("swaps unlit materials for toon ones, recolouring by name, and caches", () => {
    const wood = new MeshBasicMaterial({ color: "#e69963" });
    wood.name = "wood";
    const metal = new MeshBasicMaterial({ color: "#bdd1d6" });
    metal.name = "metal";
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), wood), new Mesh(new BoxGeometry(), [wood, metal]));
    toonifyObject(root, (name) => restyleColor(name, palette));

    const mats: MeshToonMaterial[] = [];
    root.traverse((o) => {
      if (o instanceof Mesh) mats.push(...(Array.isArray(o.material) ? o.material : [o.material]));
    });
    expect(mats).toHaveLength(3);
    for (const m of mats) expect(m).toBeInstanceOf(MeshToonMaterial);
    expect(mats[0]?.color.getHexString()).toBe(palette.accent.slice(1).toLowerCase());
    expect(mats[2]?.color.getHexString()).toBe("bdd1d6");
    // Same source + same colour -> same instance.
    expect(mats[0]).toBe(mats[1] as MeshToonMaterial);
    expect(toonFromMaterial(metal)).toBe(mats[2] as MeshToonMaterial);
  });
});
