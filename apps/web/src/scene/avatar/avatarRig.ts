/**
 * Rig helpers for robot.glb: model URL, bone lookup (the GLB names a bone and
 * the mesh under it identically, e.g. `Head`), the right-arm-only sub-clip
 * used for the raised hand, and the "think" head tilt.
 */
import { AnimationClip, type Bone, type Object3D, Quaternion, Vector3 } from "three";
import { ROBOT_CLIPS } from "./clips.ts";
import { holdClip, poseAt } from "./seatedClips.ts";

/** Resolved by Vite to a hashed asset URL; no config needed. */
export const ROBOT_MODEL_URL = new URL(
  "../../../../../packages/assets/models/robot/robot.glb",
  import.meta.url,
).href;

/** Direction the model's face points in its own space: robot.glb faces +z. */
export const MODEL_FORWARD = new Vector3(0, 0, 1);

/**
 * robot.glb faces +z, but a heading of 0 faces -z (room-layout geometry.ts;
 * three.js `rotation.y`): `RobotAvatar` turns the model half way round, so
 * every caller sets `rotation.y = heading` and the robot faces its heading.
 */
export const MODEL_YAW = Math.PI;

/** Depth-first search for a Bone by name, skipping same-named meshes. */
export function findBone(root: Object3D, name: string): Bone | undefined {
  let found: Bone | undefined;
  root.traverse((object) => {
    if (!found && object.name === name && (object as Bone).isBone) found = object as Bone;
  });
  return found;
}

/**
 * Track names of the right arm and hand. GLTFLoader sanitises node names for
 * PropertyBinding (`UpperArm.R` becomes `UpperArmR`), so both spellings match.
 */
export const RIGHT_ARM_TRACK =
  /^(Shoulder|UpperArm|LowerArm|Palm\d|Middle\d|Thumb\d?|Index\d?|Ring\d)\.?R\.(quaternion|position|scale)$/;

export const ARM_CLIP_NAME = `${ROBOT_CLIPS.wave}.arm`;

/** When `Robot_Wave` has the hand up (between two waves), seconds. */
export const RAISED_HAND_TIME = 0.9;

/**
 * The raised hand: the right-arm tracks of a clip (the wave) held at `at`
 * seconds, so it blends over any base pose and the hand stays up without
 * waving (#159: a waiting robot is still apart from its raised hand).
 */
export function armOnlyClip(source: AnimationClip, at = RAISED_HAND_TIME): AnimationClip {
  const tracks = source.tracks.filter((track) => RIGHT_ARM_TRACK.test(track.name));
  const arm = new AnimationClip(`${source.name}.arm-source`, source.duration, tracks);
  return holdClip(ARM_CLIP_NAME, poseAt(arm, Math.min(at, source.duration)), source.duration);
}

/** Small roll applied to the head bone while thinking (SPEC §9.3 "think (head tilt)"). */
export const HEAD_TILT = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.22);

/**
 * Per-bone memory for `applyPose`: the mixer only rewrites a bone when its
 * sampled value changed, so the last value we wrote and the base it came from
 * are kept to avoid compounding the offset frame after frame.
 */
export type PoseMemo = { base: Quaternion; written: Quaternion; active: boolean };

export function createPoseMemo(): PoseMemo {
  return { base: new Quaternion(), written: new Quaternion(), active: false };
}

/**
 * Multiply `offset` onto a bone's animated rotation after the mixer ran. Call
 * every frame; pass `enabled=false` to restore the animated rotation.
 */
export function applyPose(bone: Bone, offset: Quaternion, memo: PoseMemo, enabled: boolean): void {
  const current = bone.quaternion;
  if (!memo.active || !current.equals(memo.written)) memo.base.copy(current);
  if (!enabled) {
    if (memo.active) current.copy(memo.base);
    memo.active = false;
    return;
  }
  current.copy(memo.base).multiply(offset);
  memo.written.copy(current);
  memo.active = true;
}
