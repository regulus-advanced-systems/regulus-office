import { describe, expect, test } from "bun:test";
import {
  createGaitTracker,
  gaitForSpeed,
  RUN_GAIT_ABOVE,
  selectSpeed,
  WALK_GAIT_BELOW,
} from "./gait.ts";
import { RUN_SPEED, WALK_SPEED } from "./kinematics.ts";
import { createPoseBuffer } from "./remoteInterpolation.ts";

describe("speed selection", () => {
  test("Shift or a double-click path runs; otherwise walk", () => {
    expect(selectSpeed({ shift: false, pathRun: false })).toBe(WALK_SPEED);
    expect(selectSpeed({ shift: true, pathRun: false })).toBe(RUN_SPEED);
    expect(selectSpeed({ shift: false, pathRun: true })).toBe(RUN_SPEED);
    expect(selectSpeed({ shift: true, pathRun: true })).toBe(RUN_SPEED);
  });
});

describe("gait from speed", () => {
  test("the thresholds sit between walking and running speed", () => {
    expect(WALK_GAIT_BELOW).toBeGreaterThan(WALK_SPEED);
    expect(RUN_GAIT_ABOVE).toBeGreaterThan(WALK_GAIT_BELOW);
    expect(RUN_GAIT_ABOVE).toBeLessThan(RUN_SPEED);
  });

  test("walk and run speeds map to their gaits; the band in between keeps the last one", () => {
    expect(gaitForSpeed(WALK_SPEED)).toBe("walk");
    expect(gaitForSpeed(RUN_SPEED)).toBe("run");
    const between = (WALK_GAIT_BELOW + RUN_GAIT_ABOVE) / 2;
    expect(gaitForSpeed(between, "walk")).toBe("walk");
    expect(gaitForSpeed(between, "run")).toBe("run");
    expect(gaitForSpeed(0, "run")).toBe("walk");
  });

  test("the tracker smooths a jittery estimate: a walker never flickers into a run", () => {
    const tracker = createGaitTracker();
    for (let i = 0; i < 120; i++) {
      // One frame in four reads double the speed (two patches landing close together).
      tracker.update(i % 4 === 0 ? WALK_SPEED * 2 : WALK_SPEED * 0.8, 1 / 60);
      expect(tracker.gait).toBe("walk");
    }
  });

  test("the tracker breaks into a run within a fraction of a second and resets on stop", () => {
    const tracker = createGaitTracker();
    let frames = 0;
    while (tracker.update(RUN_SPEED, 1 / 60) !== "run") frames++;
    expect(frames / 60).toBeLessThan(0.4);
    tracker.reset();
    expect(tracker.gait).toBe("walk");
    expect(tracker.speed).toBe(0);
  });
});

/** A remote human moving east at `speed`, patched every `patchMs` with some arrival jitter. */
function remoteStream(speed: number, patchMs = 50) {
  const buffer = createPoseBuffer();
  const tracker = createGaitTracker();
  const jitter = [0, 18, -12, 25, -20, 5];
  let x = 0;
  let sent = 0;
  const gaits: string[] = [];
  for (let now = 0; now <= 3000; now += 1000 / 60) {
    while (sent * patchMs <= now) {
      x = (sent * patchMs * speed) / 1000;
      const t = Math.max(0, sent * patchMs + (jitter[sent % jitter.length] ?? 0));
      buffer.push({ t, x, z: 0, heading: 0 });
      sent++;
    }
    const p = buffer.sampleAt(now);
    if (!p) continue;
    if (p.moving) tracker.update(p.speed, 1 / 60);
    else tracker.reset();
    if (now > 1000) gaits.push(tracker.gait);
  }
  return gaits;
}

describe("remote gait from interpolated speed", () => {
  test("a remote walker walks and a remote runner runs, with no gait on the wire", () => {
    expect(new Set(remoteStream(WALK_SPEED))).toEqual(new Set(["walk"]));
    expect(new Set(remoteStream(RUN_SPEED))).toEqual(new Set(["run"]));
  });

  test("the interpolated speed reads the travel speed", () => {
    const b = createPoseBuffer({ delayMs: 0 });
    for (let t = 0; t <= 200; t += 50) b.push({ t, x: (t * RUN_SPEED) / 1000, z: 0, heading: 0 });
    expect(b.sampleAt(120)?.speed).toBeCloseTo(RUN_SPEED, 3);
    expect(b.sampleAt(1000)?.speed).toBe(0);
  });
});
