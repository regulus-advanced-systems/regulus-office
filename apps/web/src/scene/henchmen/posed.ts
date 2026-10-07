/**
 * Authoring a prop where it ends up (#281): something a character holds is
 * easiest to model in the held pose, but the skinned mesh wants every vertex
 * in the bind pose. `intoBindSpace` moves a geometry authored in model space
 * with the rig in `pose` back to where it must sit in the bind pose so that,
 * rigidly weighted to `bone`, it lands exactly where it was authored once the
 * rig takes that pose.
 */
import { type BufferGeometry, Euler, Matrix4 } from "three";
import type { Pose } from "./poses.ts";
import { BONE_INDEX, BONE_NAMES, type BoneName, buildSkeleton } from "./rig.ts";

const RAD = Math.PI / 180;

/** `bone`'s skinning matrix (posed world × inverse bind) with the rig standing in `pose`. */
export function skinMatrix(pose: Pose, bone: BoneName): Matrix4 {
  const { root, bones, skeleton } = buildSkeleton();
  for (const name of BONE_NAMES) {
    const deg = pose[name];
    if (deg) bones[BONE_INDEX[name]]?.rotation.copy(new Euler(deg[0] * RAD, deg[1] * RAD, deg[2] * RAD));
  }
  root.updateMatrixWorld(true);
  const i = BONE_INDEX[bone];
  return new Matrix4().multiplyMatrices(
    (bones[i] as (typeof bones)[number]).matrixWorld,
    skeleton.boneInverses[i] as Matrix4,
  );
}

export function intoBindSpace(geometry: BufferGeometry, pose: Pose, bone: BoneName): BufferGeometry {
  return geometry.applyMatrix4(skinMatrix(pose, bone).invert());
}
