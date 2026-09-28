import { describe, expect, test } from "bun:test";
import {
  cameraPosition,
  cameraZoom,
  clampZoomFactor,
  fitZoom,
  ISO_PITCH_DEG,
  isoDirection,
  projectedSize,
  ROOM_FILL_WIDTH,
  roomTarget,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_MIN,
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
