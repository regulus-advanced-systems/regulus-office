import { describe, expect, test } from "bun:test";
import {
  AnimationClip,
  type KeyframeTrack,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import {
  SEATED_CLIPS,
  SEATED_MOTIONS,
  sampleTrack,
  seatedClips,
  seatedPose,
} from "./seatedClips.ts";

/** A small stand-in for robot.glb's `Robot_Sitting`: legs swinging down over 0.42 s, no head track. */
function sitDown(): AnimationClip {
  const q = (angle: number) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
  return new AnimationClip("RobotArmature|Robot_Sitting", 0.42, [
    new VectorKeyframeTrack("Body.position", [0, 0.42], [0, 1, 0, 0, 0.6, 0]),
    new QuaternionKeyframeTrack("UpperLegL.quaternion", [0, 0.42], [...q(0), ...q(1.17)]),
    new QuaternionKeyframeTrack("LowerArmL.quaternion", [0, 0.42], [...q(0), ...q(0.3)]),
    new QuaternionKeyframeTrack("LowerArmR.quaternion", [0, 0.42], [...q(0), ...q(0.3)]),
  ]);
}

const HEAD_REST = [0, 0.1, 0, Math.sqrt(1 - 0.01)];
const rest = (bone: string) => (bone === "Head" ? HEAD_REST : undefined);

/** Angle between two rotations stored as quaternion arrays, radians (exact 0 for equal values). */
function angle(a: readonly number[], b: readonly number[]): number {
  const sign = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0) < 0 ? -1 : 1;
  const diff = Math.hypot(...a.map((v, i) => v - sign * (b[i] ?? 0)));
  const sum = Math.hypot(...a.map((v, i) => v + sign * (b[i] ?? 0)));
  return 4 * Math.atan2(diff, sum);
}

/** Distance between two values of a track: radians for rotations, metres for positions. */
function distance(track: KeyframeTrack, a: readonly number[], b: readonly number[]): number {
  if (track instanceof QuaternionKeyframeTrack) return angle(a, b);
  return Math.hypot(...a.map((x, i) => x - (b[i] ?? 0)));
}

/** How far a track moves from its first value over the clip, sampled at 60 fps. */
function travel(track: KeyframeTrack, duration: number): number {
  const first = sampleTrack(track, 0);
  let max = 0;
  for (let t = 0; t <= duration; t += 1 / 60)
    max = Math.max(max, distance(track, first, sampleTrack(track, t)));
  return max;
}

function clipsByName() {
  return new Map(seatedClips(sitDown(), rest).map((c) => [c.name, c]));
}

describe("seated clips (#159)", () => {
  test("one clip per seated state, with names that cannot clash with the GLB's", () => {
    expect([...clipsByName().keys()].sort()).toEqual(Object.values(SEATED_CLIPS).sort());
    for (const name of Object.values(SEATED_CLIPS))
      expect(name.startsWith("RobotArmature|")).toBe(false);
  });

  test("the seated pose is the last frame of the sit-down, plus the head at rest", () => {
    const pose = seatedPose(sitDown(), rest);
    const leg = pose.get("UpperLegL.quaternion")?.value ?? [];
    expect(angle(leg, [Math.sin(1.17 / 2), 0, 0, Math.cos(1.17 / 2)])).toBeLessThan(1e-6);
    const body = pose.get("Body.position")?.value ?? [];
    expect(Math.hypot(body[0] ?? 1, (body[1] ?? 0) - 0.6, body[2] ?? 1)).toBeLessThan(1e-6);
    // Robot_Sitting has no head track: the head joins at its rest rotation.
    expect(pose.get("Head.quaternion")?.value).toEqual(HEAD_REST);
  });

  test("the idle clip holds the seated pose: no bone moves at all", () => {
    const idle = clipsByName().get(SEATED_CLIPS.idle) as AnimationClip;
    expect(idle.tracks.length).toBeGreaterThan(0);
    for (const track of idle.tracks) expect(travel(track, idle.duration)).toBe(0);
  });

  test("every seated clip has the same tracks, so a switch never strands a bone", () => {
    const names = (c: AnimationClip) => c.tracks.map((t) => t.name).sort();
    const clips = [...clipsByName().values()];
    for (const clip of clips) expect(names(clip)).toEqual(names(clips[0] as AnimationClip));
  });

  test("typing moves the forearms and the head, never the legs or the hips", () => {
    const type = clipsByName().get(SEATED_CLIPS.type) as AnimationClip;
    const track = (name: string) => type.tracks.find((t) => t.name === name) as KeyframeTrack;
    expect(travel(track("LowerArmL.quaternion"), type.duration)).toBeGreaterThan(0.1);
    expect(travel(track("LowerArmR.quaternion"), type.duration)).toBeGreaterThan(0.1);
    expect(travel(track("Head.quaternion"), type.duration)).toBeGreaterThan(0.02);
    expect(travel(track("UpperLegL.quaternion"), type.duration)).toBe(0);
    expect(travel(track("Body.position"), type.duration)).toBe(0);
  });

  test("reading and thinking move the head only", () => {
    for (const name of [SEATED_CLIPS.read, SEATED_CLIPS.think]) {
      const clip = clipsByName().get(name) as AnimationClip;
      for (const track of clip.tracks) {
        const moves = travel(track, clip.duration) > 0;
        expect([track.name, moves]).toEqual([track.name, track.name === "Head.quaternion"]);
      }
    }
  });

  test("the motion loops are seamless: every wiggle's period divides the clip, first key = last key", () => {
    for (const motion of Object.values(SEATED_MOTIONS))
      for (const w of motion.wiggles) {
        const cycles = motion.duration / w.period;
        expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-9);
      }
    for (const clip of clipsByName().values())
      for (const track of clip.tracks) {
        const first = sampleTrack(track, 0);
        const last = sampleTrack(track, clip.duration);
        expect(distance(track, first, last)).toBeLessThan(1e-5);
      }
  });

  test("the motions are small: no bone turns more than 20° away from the seated pose", () => {
    for (const motion of Object.values(SEATED_MOTIONS))
      for (const w of motion.wiggles) expect(Math.abs(w.bias) + w.amp).toBeLessThan(0.35);
  });
});
