/**
 * The genius skeleton: eleven bones with rigid parts (every vertex follows
 * exactly one bone, like the jointed low-poly look of the genre). Bone rest
 * positions come from the archetype's proportions, so one set of clip
 * builders (clips/) animates every body.
 *
 * Model space: metres, feet on y = 0, facing +z (like robot.glb, so the
 * shared MODEL_YAW turns it to the heading); the character's left is +x.
 */
import { Bone } from "three";

export const BONES = [
  "hips",
  "spine",
  "head",
  "armL",
  "foreL",
  "armR",
  "foreR",
  "thighL",
  "shinL",
  "thighR",
  "shinR",
] as const;
export type BoneName = (typeof BONES)[number];

/** Node names carry a prefix so scene-wide name lookups never hit a genius bone. */
export const boneNodeName = (bone: BoneName): string => `genius_${bone}`;

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  spine: "hips",
  head: "spine",
  armL: "spine",
  foreL: "armL",
  armR: "spine",
  foreR: "armR",
  thighL: "hips",
  shinL: "thighL",
  thighR: "hips",
  shinR: "thighR",
};

/** Proportions of one archetype; the exaggeration lives here. */
export interface Body {
  /** Hip joint height. */
  hipY: number;
  /** Half the distance between the legs. */
  hipX: number;
  thigh: number;
  shin: number;
  /** Spine joint above the hips (the pelvis sits between). */
  waist: number;
  /** Neck joint above the spine joint. */
  torso: number;
  /** Shoulder joints: height above the spine joint and half width. */
  shoulderY: number;
  shoulderX: number;
  upperArm: number;
  foreArm: number;
  /** Head cube size; the face is on its +z side. */
  head: number;
  /** Back of the torso behind the spine axis (seated fit against a backrest). */
  backDepth: number;
  /** Bottom of the pelvis below the hip joint (seated fit on a cushion). */
  seatDrop: number;
  /** Top of the head (or tallest default hair) above the floor; the name plate floats above it. */
  height: number;
}

export type Vec3 = [number, number, number];

/** World (model-space) rest position of every joint. */
export function restJoints(body: Body): Record<BoneName, Vec3> {
  const spineY = body.hipY + body.waist;
  const shoulderY = spineY + body.shoulderY;
  const kneeY = body.hipY - body.thigh;
  return {
    hips: [0, body.hipY, 0],
    spine: [0, spineY, 0],
    head: [0, spineY + body.torso, 0],
    armL: [body.shoulderX, shoulderY, 0],
    foreL: [body.shoulderX, shoulderY - body.upperArm, 0],
    armR: [-body.shoulderX, shoulderY, 0],
    foreR: [-body.shoulderX, shoulderY - body.upperArm, 0],
    thighL: [body.hipX, body.hipY, 0],
    shinL: [body.hipX, kneeY, 0],
    thighR: [-body.hipX, body.hipY, 0],
    shinR: [-body.hipX, kneeY, 0],
  };
}

/** Rest position of each bone relative to its parent (what goes in `bone.position`). */
export function restLocal(body: Body): Record<BoneName, Vec3> {
  const world = restJoints(body);
  const out = {} as Record<BoneName, Vec3>;
  for (const bone of BONES) {
    const parent = PARENT[bone];
    const p = world[bone];
    const q = parent ? world[parent] : ([0, 0, 0] as Vec3);
    out[bone] = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  }
  return out;
}

/** Fresh bones in rest pose, in `BONES` order (the skin index of a part is its bone's index). */
export function createBones(body: Body): Bone[] {
  const local = restLocal(body);
  const bones = BONES.map((name) => {
    const bone = new Bone();
    bone.name = boneNodeName(name);
    bone.position.set(...local[name]);
    return bone;
  });
  BONES.forEach((name, i) => {
    const parent = PARENT[name];
    if (parent) bones[BONES.indexOf(parent)]?.add(bones[i] as Bone);
  });
  return bones;
}

export const boneIndex = (bone: BoneName): number => BONES.indexOf(bone);
