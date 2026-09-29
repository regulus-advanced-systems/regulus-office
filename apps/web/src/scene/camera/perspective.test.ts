import { describe, expect, test } from "bun:test";
import { PerspectiveCamera } from "three";
import { BODY_RADIUS, EYE_HEIGHT_RATIO } from "../fpv/fpvMove.ts";
import {
  BASE_POINTER_SPEED,
  clampFovSetting,
  clampMouseSensitivity,
  DEFAULT_FPV_FOV,
  effectiveVerticalFov,
  FPV_FAR,
  FPV_NEAR,
  fitOrthographic,
  fitPerspective,
  horizontalFov,
  MAX_FPV_FOV,
  MAX_HORIZONTAL_FOV,
  MIN_FPV_FOV,
  MIN_HORIZONTAL_FOV,
  pointerSpeed,
  polarLimits,
  safeAspect,
  verticalFovFor,
} from "./perspective.ts";

const HD = 1920 / 1080;
const ULTRA = 2560 / 1080;
const SUPER_ULTRA = 5120 / 1440;

describe("FOV conversion", () => {
  test("vertical and horizontal FOV are inverse", () => {
    for (const aspect of [0.5, 1, HD, ULTRA]) {
      for (const v of [40, 60, 75]) {
        expect(verticalFovFor(horizontalFov(v, aspect), aspect)).toBeCloseTo(v, 9);
      }
    }
  });

  test("known values", () => {
    expect(horizontalFov(60, 1)).toBeCloseTo(60, 9);
    expect(horizontalFov(60, HD)).toBeCloseTo(91.49, 2);
    expect(horizontalFov(90, 1)).toBeCloseTo(90, 9);
  });

  test("safeAspect falls back to 16:9 for a zero-sized canvas", () => {
    expect(safeAspect(1920, 1080)).toBeCloseTo(HD, 12);
    expect(safeAspect(0, 0)).toBeCloseTo(HD, 12);
    expect(safeAspect(100, 0)).toBeCloseTo(HD, 12);
  });
});

describe("effective vertical FOV", () => {
  test("16:9 renders the setting unchanged across most of the range", () => {
    expect(effectiveVerticalFov(DEFAULT_FPV_FOV, HD)).toBe(60);
    expect(effectiveVerticalFov(MIN_FPV_FOV, HD)).toBe(MIN_FPV_FOV);
    expect(effectiveVerticalFov(70, HD)).toBe(70);
  });

  test("ultra-wide screens are capped at the horizontal limit", () => {
    for (const aspect of [ULTRA, SUPER_ULTRA]) {
      const v = effectiveVerticalFov(DEFAULT_FPV_FOV, aspect);
      expect(v).toBeLessThan(DEFAULT_FPV_FOV);
      expect(horizontalFov(v, aspect)).toBeCloseTo(MAX_HORIZONTAL_FOV, 9);
    }
    // 2560x1080 at the default: ~57.6 deg vertical, 105 deg horizontal.
    expect(effectiveVerticalFov(DEFAULT_FPV_FOV, ULTRA)).toBeCloseTo(57.6, 1);
  });

  test("the horizontal FOV never exceeds the cap for any setting or aspect", () => {
    for (let fov = MIN_FPV_FOV; fov <= MAX_FPV_FOV; fov += 5) {
      for (const aspect of [1, 4 / 3, HD, 16 / 10, ULTRA, SUPER_ULTRA]) {
        const h = horizontalFov(effectiveVerticalFov(fov, aspect), aspect);
        expect(h).toBeLessThanOrEqual(MAX_HORIZONTAL_FOV + 1e-9);
      }
    }
  });

  test("portrait screens keep a usable horizontal view", () => {
    const v = effectiveVerticalFov(DEFAULT_FPV_FOV, 0.75);
    expect(horizontalFov(v, 0.75)).toBeCloseTo(MIN_HORIZONTAL_FOV, 9);
    expect(effectiveVerticalFov(DEFAULT_FPV_FOV, 0.2)).toBe(90);
  });

  test("settings outside the slider are clamped", () => {
    expect(clampFovSetting(10)).toBe(MIN_FPV_FOV);
    expect(clampFovSetting(170)).toBe(MAX_FPV_FOV);
    expect(clampFovSetting(Number.NaN)).toBe(DEFAULT_FPV_FOV);
    expect(effectiveVerticalFov(170, 1)).toBe(MAX_FPV_FOV);
  });
});

describe("fitPerspective", () => {
  test("sets the aspect from the canvas, not 1 (the #144 bug)", () => {
    const cam = new PerspectiveCamera(50, 1, FPV_NEAR, FPV_FAR);
    expect(fitPerspective(cam, 1920, 1080, DEFAULT_FPV_FOV)).toBe(true);
    expect(cam.aspect).toBeCloseTo(HD, 12);
    expect(cam.fov).toBe(60);
    // The projection matrix was rebuilt: x scale = y scale / aspect.
    const e = cam.projectionMatrix.elements;
    expect(e[0] * cam.aspect).toBeCloseTo(e[5], 9);
    expect(fitPerspective(cam, 1920, 1080, DEFAULT_FPV_FOV)).toBe(false);
  });

  test("follows a resize to ultra-wide", () => {
    const cam = new PerspectiveCamera(50, 1, FPV_NEAR, FPV_FAR);
    fitPerspective(cam, 1920, 1080, DEFAULT_FPV_FOV);
    expect(fitPerspective(cam, 2560, 1080, DEFAULT_FPV_FOV)).toBe(true);
    expect(cam.aspect).toBeCloseTo(ULTRA, 12);
    expect(horizontalFov(cam.fov, cam.aspect)).toBeCloseTo(MAX_HORIZONTAL_FOV, 9);
  });

  test("fitOrthographic sizes the frustum in pixels like R3F", () => {
    const cam = { left: 0, right: 0, top: 0, bottom: 0, calls: 0 } as {
      left: number;
      right: number;
      top: number;
      bottom: number;
      calls: number;
      updateProjectionMatrix(): void;
    };
    cam.updateProjectionMatrix = () => void cam.calls++;
    fitOrthographic(cam, 2560, 1080);
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-1280, 1280, 540, -540]);
    expect(cam.calls).toBe(1);
  });
});

describe("mouse look", () => {
  test("pitch is limited to +-80 degrees", () => {
    const { min, max } = polarLimits();
    expect(90 - (min * 180) / Math.PI).toBeCloseTo(80, 9);
    expect((max * 180) / Math.PI - 90).toBeCloseTo(80, 9);
  });

  test("sensitivity scales the pointer speed and is clamped", () => {
    expect(pointerSpeed(1)).toBe(BASE_POINTER_SPEED);
    expect(pointerSpeed(2)).toBeCloseTo(2 * BASE_POINTER_SPEED, 12);
    expect(clampMouseSensitivity(0)).toBe(0.25);
    expect(clampMouseSensitivity(9)).toBe(2.5);
    expect(clampMouseSensitivity(Number.NaN)).toBe(1);
  });
});

describe("near plane and eye height", () => {
  test("the near plane never reaches past the player's collision body", () => {
    // Worst case: the corner of the near plane at the widest allowed view.
    const aspect = SUPER_ULTRA;
    const v = effectiveVerticalFov(MAX_FPV_FOV, aspect);
    const ty = Math.tan(((v / 2) * Math.PI) / 180);
    const tx = Math.tan(((horizontalFov(v, aspect) / 2) * Math.PI) / 180);
    const corner = FPV_NEAR * Math.hypot(1, tx, ty);
    expect(corner).toBeLessThan(BODY_RADIUS);
  });

  test("eye height sits between desk tops and the top of a 3 m wall", () => {
    const eye = EYE_HEIGHT_RATIO * 1.6;
    expect(eye).toBeCloseTo(1.44, 9);
    expect(eye).toBeGreaterThan(0.76 * 1.7);
    expect(eye).toBeLessThan(3 / 2);
  });
});
