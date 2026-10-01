import { describe, expect, test } from "bun:test";
import {
  MeshToonMaterial,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import {
  applyCutaway,
  BAYER4,
  bayer4,
  CUTAWAY_DEFAULTS,
  CUTAWAY_GLSL,
  createCutawayUniforms,
  cutawayAmount,
  cutawayDiscards,
  updateCutaway,
} from "./cutaway.ts";

/** Camera 12 m south of and above the player, as the 3/4 overhead camera sits. */
const focus = { x: 0, y: 0, z: 0 };
const camera = { x: 0, y: 14, z: 12 };
const at = (x: number, y: number, z: number) => cutawayAmount({ x, y, z }, camera, focus);

describe("cutawayAmount: which wall fragments fade", () => {
  test("a wall between the camera and the player is removed above the plinth", () => {
    expect(at(0, 2, 4)).toBe(1);
    expect(at(0.8, 1.5, 6)).toBe(1);
  });

  test("the plinth and its rail always stay (the clean cut edge)", () => {
    expect(at(0, CUTAWAY_DEFAULTS.keepBelow - 0.01, 4)).toBe(0);
    expect(at(0, 0.2, 4)).toBe(0);
  });

  test("walls behind the player (away from the camera) stay", () => {
    expect(at(0, 2, -3)).toBe(0);
    expect(at(0, 2, 0)).toBe(0);
  });

  test("walls well off to the side stay; the region widens toward the camera", () => {
    expect(at(8, 2, 1)).toBe(0);
    // 4 m to the side is outside the region near the player but inside it nearer the camera.
    expect(at(4, 2, 1.2)).toBe(0);
    expect(at(4, 2, 6)).toBe(1);
  });

  test("the edges are soft and monotonic (a fade, not a hard cut)", () => {
    const xs = [2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2];
    const amounts = xs.map((x) => at(x, 2, 1.5));
    for (let i = 1; i < amounts.length; i++)
      expect(amounts[i] ?? 0).toBeLessThanOrEqual(amounts[i - 1] ?? 0);
    expect(amounts.some((a) => a > 0 && a < 1)).toBe(true);
  });

  test("measured on the ground plane, so it works from any yaw", () => {
    const yawed = { x: 12, y: 14, z: 0 };
    expect(cutawayAmount({ x: 4, y: 2, z: 0 }, yawed, focus)).toBe(1);
    expect(cutawayAmount({ x: 0, y: 2, z: 4 }, yawed, focus)).toBe(0);
  });

  test("a camera straight above the player cuts nothing", () => {
    expect(cutawayAmount({ x: 0, y: 2, z: 1 }, { x: 0, y: 20, z: 0 }, focus)).toBe(0);
  });
});

describe("ordered dither", () => {
  test("the 4x4 Bayer matrix has each threshold once", () => {
    expect([...BAYER4].map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
  });

  test("a 4x4 block drops the share of pixels the amount asks for", () => {
    for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
      let dropped = 0;
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) if (cutawayDiscards(amount, x, y)) dropped++;
      expect(dropped).toBe(Math.round(amount * 16));
    }
  });

  test("thresholds tile every 4 pixels and handle negative coordinates", () => {
    expect(bayer4(5, 9)).toBe(bayer4(1, 1));
    expect(bayer4(-1, -1)).toBe(bayer4(3, 3));
  });

  test("the GLSL uses the same matrix", () => {
    expect(CUTAWAY_GLSL).toContain(`int[16](${BAYER4.join(", ")})`);
  });
});

describe("applyCutaway patches a material", () => {
  test("uniforms are shared by reference and the shader gains the cut", () => {
    const uniforms = createCutawayUniforms();
    const material = applyCutaway(new MeshToonMaterial(), uniforms);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\nvoid main(){\n#include <project_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main(){\n#include <clipping_planes_fragment>\n}",
    } as unknown as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.uniforms.uCutFocus).toBe(uniforms.uCutFocus);
    expect(shader.vertexShader).toContain("vCutWorld = ");
    expect(shader.fragmentShader).toContain("discard");
    expect(material.customProgramCacheKey()).toContain("lair-cutaway");
  });

  test("updateCutaway moves the shared uniforms", () => {
    const u = createCutawayUniforms();
    updateCutaway(u, { x: 1, y: 2, z: 3 }, { x: 4, y: 0, z: 6 });
    expect(u.uCutCamera.value.toArray()).toEqual([1, 2, 3]);
    expect(u.uCutFocus.value.toArray()).toEqual([4, 0, 6]);
  });
});
