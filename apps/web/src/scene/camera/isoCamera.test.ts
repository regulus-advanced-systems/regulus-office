import { describe, expect, test } from "bun:test";
import {
  CAMERA_DISTANCE,
  CAMERA_FAR,
  CAMERA_NEAR,
  cameraPosition,
  cameraZoom,
  clampZoomFactor,
  fitZoom,
  ISO_PITCH_DEG,
  isoDirection,
  maxZoomFactor,
  projectedSize,
  ROOM_FILL_WIDTH,
  roomTarget,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_MIN,
  ZOOM_REFERENCE_WIDTH,
  zoomFactorAfterWheel,
} from "./isoCamera.ts";

const lobby = { width: 14, depth: 11, height: 3 };
const hd = { width: 1920, height: 1080 };

describe("isoDirection", () => {
  test("yaw 45°, pitch 35.264° is the (1,1,1) diagonal", () => {
    const d = isoDirection();
    expect(d.x).toBeCloseTo(Math.SQRT1_2 * Math.cos((ISO_PITCH_DEG * Math.PI) / 180), 6);
    expect(d.x).toBeCloseTo(d.y, 3);
    expect(d.y).toBeCloseTo(d.z, 3);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
  });

  test("pitch is measured from the ground plane", () => {
    const d = isoDirection(45, 35.264);
    expect(Math.asin(d.y) * (180 / Math.PI)).toBeCloseTo(35.264, 3);
  });
});

describe("cameraPosition / roomTarget", () => {
  test("camera sits on the diagonal above the room centre", () => {
    const target = roomTarget(lobby);
    expect(target.x).toBe(7);
    expect(target.z).toBe(5.5);
    const p = cameraPosition(target, 60);
    expect(p.x - target.x).toBeCloseTo(p.z - target.z, 9);
    expect(p.y).toBeGreaterThan(target.y);
    expect(Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z)).toBeCloseTo(60, 6);
  });
});

describe("projectedSize / fitZoom", () => {
  test("floor diamond width is (w + d) / sqrt 2 at yaw 45°", () => {
    const s = projectedSize(lobby);
    expect(s.width).toBeCloseTo(25 / Math.SQRT2, 6);
    expect(s.height).toBeGreaterThan(s.width * 0.5);
    expect(s.height).toBeLessThan(s.width);
  });

  test("room fills ROOM_FILL_WIDTH of a 1080p viewport", () => {
    const zoom = fitZoom(hd, lobby);
    expect(zoom * projectedSize(lobby).width).toBeCloseTo(ROOM_FILL_WIDTH * hd.width, 6);
    expect(zoom * projectedSize(lobby).height).toBeLessThan(hd.height);
  });

  test("a tall narrow viewport is limited by height instead", () => {
    const zoom = fitZoom({ width: 800, height: 300 }, lobby);
    expect(zoom * projectedSize(lobby).height).toBeCloseTo(300 * 0.9, 6);
    expect(zoom * projectedSize(lobby).width).toBeLessThan(800 * ROOM_FILL_WIDTH);
  });

  test("zoom never drops below 1 px per metre", () => {
    expect(fitZoom({ width: 1, height: 1 }, lobby)).toBe(1);
  });
});

describe("zoom limits", () => {
  test("clamps to [min, max] and rejects NaN", () => {
    expect(clampZoomFactor(0)).toBe(ZOOM_FACTOR_MIN);
    expect(clampZoomFactor(99)).toBe(ZOOM_FACTOR_MAX);
    expect(clampZoomFactor(1.5)).toBe(1.5);
    expect(clampZoomFactor(Number.NaN)).toBe(1);
  });

  test("scrolling up zooms in, down zooms out, both bounded", () => {
    expect(zoomFactorAfterWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomFactorAfterWheel(1, 100)).toBeLessThan(1);
    expect(zoomFactorAfterWheel(1, -100_000)).toBe(ZOOM_FACTOR_MAX);
    expect(zoomFactorAfterWheel(1, 100_000)).toBe(ZOOM_FACTOR_MIN);
    // Symmetric: a scroll and its reverse cancel out.
    expect(zoomFactorAfterWheel(zoomFactorAfterWheel(1, 120), -120)).toBeCloseTo(1, 9);
  });

  test("cameraZoom composes fit and factor", () => {
    expect(cameraZoom(hd, lobby, 2)).toBeCloseTo(fitZoom(hd, lobby) * 2, 9);
    expect(cameraZoom(hd, lobby, 0)).toBeCloseTo(fitZoom(hd, lobby) * ZOOM_FACTOR_MIN, 9);
  });
});

describe("larger rooms (#118)", () => {
  const small = { width: 16, depth: 13, height: 3 };
  const large = { width: 28, depth: 18, height: 3 };

  test("the small office is the zoom reference and keeps the plain limit", () => {
    expect(projectedSize(small).width).toBeCloseTo(ZOOM_REFERENCE_WIDTH, 9);
    expect(maxZoomFactor(small)).toBeCloseTo(ZOOM_FACTOR_MAX, 9);
    expect(maxZoomFactor(lobby)).toBe(ZOOM_FACTOR_MAX);
    expect(maxZoomFactor()).toBe(ZOOM_FACTOR_MAX);
  });

  test("a large room can be zoomed as close as the small one", () => {
    const closestLarge = cameraZoom(hd, large, 99);
    const closestSmall = cameraZoom(hd, small, 99);
    expect(closestLarge).toBeCloseTo(closestSmall, 6);
    expect(zoomFactorAfterWheel(1, -100_000, undefined, large)).toBe(maxZoomFactor(large));
    expect(maxZoomFactor(large)).toBeGreaterThan(ZOOM_FACTOR_MAX);
  });

  test("the large room still fits the viewport at the default zoom", () => {
    const zoom = cameraZoom(hd, large, 1);
    expect(zoom * projectedSize(large).width).toBeCloseTo(ROOM_FILL_WIDTH * hd.width, 6);
    expect(zoom * projectedSize(large).height).toBeLessThan(hd.height);
  });

  test("near and far planes enclose every corner of the large room", () => {
    const target = roomTarget(large);
    const d = isoDirection();
    for (const x of [0, large.width])
      for (const z of [0, large.depth])
        for (const y of [0, large.height]) {
          const along = (x - target.x) * d.x + (y - target.y) * d.y + (z - target.z) * d.z;
          const depth = CAMERA_DISTANCE - along;
          expect(depth).toBeGreaterThan(CAMERA_NEAR);
          expect(depth).toBeLessThan(CAMERA_FAR);
        }
  });
});
