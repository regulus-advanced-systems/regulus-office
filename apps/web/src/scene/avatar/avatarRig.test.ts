import { describe, expect, test } from "bun:test";
import {
  AnimationClip,
  Bone,
  Group,
  Mesh,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import { ARM_CLIP_NAME, armOnlyClip, findBone, RIGHT_ARM_TRACK } from "./avatarRig.ts";

describe("avatarRig", () => {
  test("right-arm filter matches GLTFLoader-sanitised and raw track names, not the left side or the body", () => {
    for (const name of [
      "UpperArmR.quaternion",
      "UpperArm.R.quaternion",
      "ShoulderR.quaternion",
      "Thumb2R.quaternion",
      "IndexR.quaternion",
      "Palm1R.position",
    ]) {
      expect(RIGHT_ARM_TRACK.test(name)).toBe(true);
    }
    for (const name of [
      "UpperArmL.quaternion",
      "Body.quaternion",
      "Head.quaternion",
      "UpperLegR.quaternion",
      "FootR.position",
    ]) {
      expect(RIGHT_ARM_TRACK.test(name)).toBe(false);
    }
  });

  test("armOnlyClip keeps only right-arm tracks and the source duration", () => {
    const q = [0, 0, 0, 1, 0, 0, 0, 1];
    const source = new AnimationClip("RobotArmature|Robot_Wave", 1.83, [
      new QuaternionKeyframeTrack("Body.quaternion", [0, 1], q),
      new QuaternionKeyframeTrack("UpperArmR.quaternion", [0, 1], q),
      new QuaternionKeyframeTrack("LowerArmR.quaternion", [0, 1], q),
      new VectorKeyframeTrack("FootR.position", [0, 1], [0, 0, 0, 0, 0, 0]),
    ]);
    const arm = armOnlyClip(source);
    expect(arm.name).toBe(ARM_CLIP_NAME);
    expect(arm.duration).toBe(1.83);
    expect(arm.tracks.map((t) => t.name)).toEqual(["UpperArmR.quaternion", "LowerArmR.quaternion"]);
    expect(source.tracks).toHaveLength(4);
  });

  test("the raised hand is held still at the wave's hand-up moment, not waving (#159)", () => {
    const up = [Math.sin(0.6), 0, 0, Math.cos(0.6)];
    const down = [0, 0, 0, 1];
    const source = new AnimationClip("RobotArmature|Robot_Wave", 1.8, [
      new QuaternionKeyframeTrack("LowerArmR.quaternion", [0, 0.9, 1.8], [...down, ...up, ...down]),
    ]);
    const arm = armOnlyClip(source, 0.9);
    const track = arm.tracks[0];
    expect(track?.times).toHaveLength(2);
    const values = Array.from(track?.values ?? []);
    expect(values.slice(0, 4)).toEqual(values.slice(4));
    values.slice(0, 4).forEach((v, i) => expect(v).toBeCloseTo(up[i] ?? 0, 5));
  });

  test("findBone skips the same-named mesh and returns the bone", () => {
    const root = new Group();
    const bone = new Bone();
    bone.name = "Head";
    const mesh = new Mesh();
    mesh.name = "Head";
    root.add(mesh);
    root.add(bone);
    expect(findBone(root, "Head")).toBe(bone);
    expect(findBone(root, "Nope")).toBeUndefined();
  });
});

describe("applyPose", () => {
  test("offsets the animated rotation without compounding when the mixer skips a frame", async () => {
    const { applyPose, createPoseMemo, HEAD_TILT } = await import("./avatarRig.ts");
    const { Bone: B, Quaternion } = await import("three");
    const bone = new B();
    const memo = createPoseMemo();
    const animated = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, 0.5);
    bone.quaternion.copy(animated);
    applyPose(bone, HEAD_TILT, memo, true);
    const once = bone.quaternion.clone();
    // Mixer did not touch the bone this frame (unchanged sample): the offset must not stack.
    applyPose(bone, HEAD_TILT, memo, true);
    applyPose(bone, HEAD_TILT, memo, true);
    expect(bone.quaternion.angleTo(once)).toBeLessThan(1e-6);
    expect(once.angleTo(animated)).toBeCloseTo(0.22, 3);
    // Mixer wrote a new value: base follows it.
    const next = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, 1.0);
    bone.quaternion.copy(next);
    applyPose(bone, HEAD_TILT, memo, true);
    expect(bone.quaternion.angleTo(next)).toBeCloseTo(0.22, 3);
    // Disabling restores the animated rotation.
    applyPose(bone, HEAD_TILT, memo, false);
    expect(bone.quaternion.angleTo(next)).toBeLessThan(1e-6);
  });
});
