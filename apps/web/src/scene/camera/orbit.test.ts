import { describe, expect, test } from "bun:test";
import { inputVector } from "../movement/wasd.ts";
import {
  CLOSE_PITCH_DEG,
  clipPlanes,
  DEFAULT_ZOOM,
  dampYaw,
  MIN_DISTANCE,
  ORBIT_PITCH_DEG,
  orbitPose,
  overviewDistance,
  wrapYaw,
  zoomDistance,
  zoomPitchDeg,
} from "./orbit.ts";

const base = { player: { x: 10, z: 20 }, centre: { x: 60, z: 60 }, extent: 120 };

describe("the compound camera (#186, SPEC §9.2)", () => {
  test("3/4 overhead at about 50° over most of the zoom, lower close behind the player", () => {
    expect(zoomPitchDeg(DEFAULT_ZOOM)).toBe(ORBIT_PITCH_DEG);
    expect(zoomPitchDeg(1)).toBe(ORBIT_PITCH_DEG);
    expect(zoomPitchDeg(0)).toBe(CLOSE_PITCH_DEG);
  });

  test("zoom runs from a close third-person view to an overview of the whole compound", () => {
    const max = overviewDistance(base.extent);
    expect(zoomDistance(0, max)).toBeCloseTo(MIN_DISTANCE, 5);
    expect(zoomDistance(1, max)).toBeCloseTo(max, 5);
    for (let z = 0; z < 1; z += 0.1)
      expect(zoomDistance(z + 0.1, max)).toBeGreaterThan(zoomDistance(z, max));
    // Close up the camera follows the player; at the overview it frames the compound's middle.
    expect(orbitPose({ ...base, yaw: 0, zoom: DEFAULT_ZOOM }).target).toMatchObject({
      x: 10,
      z: 20,
    });
    expect(orbitPose({ ...base, yaw: 0, zoom: 1 }).target).toMatchObject({ x: 60, z: 60 });
  });

  test("the camera sits at +sin/+cos of its yaw, so WASD's W walks up the screen", () => {
    for (const deg of [0, 45, 90, 200, -135]) {
      const yaw = (deg * Math.PI) / 180;
      const pose = orbitPose({ ...base, yaw, zoom: DEFAULT_ZOOM });
      const toCamera = { x: pose.position.x - pose.target.x, z: pose.position.z - pose.target.z };
      const w = inputVector({ forward: true, back: false, left: false, right: false }, deg);
      // W walks straight away from the camera on the ground.
      const len = Math.hypot(toCamera.x, toCamera.z);
      expect(w.x).toBeCloseTo(-toCamera.x / len, 5);
      expect(w.z).toBeCloseTo(-toCamera.z / len, 5);
    }
  });

  test("near and far planes keep the player and the far side of the compound in view", () => {
    const close = clipPlanes(5, 120);
    expect(close.near).toBeLessThan(1);
    const far = clipPlanes(overviewDistance(120), 120);
    expect(far.far).toBeGreaterThan(overviewDistance(120) + 120);
  });

  test("yaw eases the short way round", () => {
    expect(wrapYaw(3 * Math.PI)).toBeCloseTo(-Math.PI, 5);
    const next = dampYaw(Math.PI - 0.1, -Math.PI + 0.1, 0.05);
    expect(Math.abs(wrapYaw(next - Math.PI))).toBeLessThan(0.1);
  });
});
