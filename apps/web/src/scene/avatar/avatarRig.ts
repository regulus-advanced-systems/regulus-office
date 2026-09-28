/**
 * Rig helpers for robot.glb: model URL, bone lookup (the GLB names a bone and
 * the mesh under it identically, e.g. `Head`), the right-arm-only sub-clip
 * used for the raised hand, and the "think" head tilt.
 */
import { AnimationClip, type Bone, type Object3D, Quaternion, Vector3 } from "three";
import { ROBOT_CLIPS } from "./clips.ts";

/** Resolved by Vite to a hashed asset URL; no config needed. */
export const ROBOT_MODEL_URL = new URL(
  "../../../../../packages/assets/models/robot/robot.glb",
  import.meta.url,
).href;

/** Depth-first search for a Bone by name, skipping same-named meshes. */
export function findBone(root: Object3D, name: string): Bone | undefined {
  let found: Bone | undefined;
  root.traverse((object) => {
    if (!found && object.name === name && (object as Bone).isBone) found = object as Bone;
  });
  return found;
}

/** Track names of the right arm and hand, e.g. `UpperArm.R.quaternion`. */
export const RIGHT_ARM_TRACK =
  /^(Shoulder|UpperArm|LowerArm|Palm\d|Middle\d|Thumb\d?|Index\d?|Ring\d)\.R\./;

export const ARM_CLIP_NAME = `${ROBOT_CLIPS.wave}.arm`;

/** Sub-clip with only the right-arm tracks of a clip, so it can blend over any base pose. */
export function armOnlyClip(source: AnimationClip): AnimationClip {
  const tracks = source.tracks.filter((track) => RIGHT_ARM_TRACK.test(track.name));
  return new AnimationClip(ARM_CLIP_NAME, source.duration, tracks);
}

/** Small roll applied to the head bone each frame while thinking (SPEC §9.3 "think (head tilt)"). */
export const HEAD_TILT = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.22);
