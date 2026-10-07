/**
 * The henchman's skeleton (#184), built in code. Bone names follow robot.glb
 * (`Hips`, `Abdomen`, `Body`, `Head`, `UpperArmL`, `LowerArmR`, `UpperLegL`, …),
 * so the e2e bone probes (tests/e2e/boneProbes.ts, #200), the seated cheer
 * (avatar/seatedClips.ts, #202) and the think head tilt work unchanged.
 *
 * Model space is metres, feet on y=0, facing +z, the character's left at +x
 * (as robot.glb: right hand at -x). Every bone's rest rotation is identity, so
 * a pose is just a rotation per bone (clips.ts) and the bind pose is the
 * geometry as authored (body.ts).
 *
 * Proportions (#281): a tall, slim adult about seven heads high, the legs a
 * little over half the height, the shoulder joints wider apart than the hips.
 * The torso is as long as it was (hips to shoulders), so the seated poses
 * still put the hands on the desk.
 */
import { Bone, Skeleton, Vector3 } from "three";

export const BONE_NAMES = [
  "Hips",
  "Abdomen",
  "Body",
  "Neck",
  "Head",
  "UpperArmL",
  "LowerArmL",
  "HandL",
  "UpperArmR",
  "LowerArmR",
  "HandR",
  "UpperLegL",
  "LowerLegL",
  "FootL",
  "UpperLegR",
  "LowerLegR",
  "FootR",
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

/** Parent and offset from the parent (metres) of every bone; `Hips` hangs off the model root. */
export const BONE_SPECS: Readonly<
  Record<BoneName, { parent: BoneName | null; at: readonly [number, number, number] }>
> = {
  Hips: { parent: null, at: [0, 0.92, 0] },
  Abdomen: { parent: "Hips", at: [0, 0.12, 0] },
  Body: { parent: "Abdomen", at: [0, 0.15, 0] },
  Neck: { parent: "Body", at: [0, 0.24, 0] },
  Head: { parent: "Neck", at: [0, 0.06, 0] },
  UpperArmL: { parent: "Body", at: [0.2, 0.19, 0] },
  LowerArmL: { parent: "UpperArmL", at: [0, -0.27, 0] },
  HandL: { parent: "LowerArmL", at: [0, -0.25, 0] },
  UpperArmR: { parent: "Body", at: [-0.2, 0.19, 0] },
  LowerArmR: { parent: "UpperArmR", at: [0, -0.27, 0] },
  HandR: { parent: "LowerArmR", at: [0, -0.25, 0] },
  UpperLegL: { parent: "Hips", at: [0.085, -0.04, 0] },
  LowerLegL: { parent: "UpperLegL", at: [0, -0.41, 0] },
  FootL: { parent: "LowerLegL", at: [0, -0.395, 0] },
  UpperLegR: { parent: "Hips", at: [-0.085, -0.04, 0] },
  LowerLegR: { parent: "UpperLegR", at: [0, -0.41, 0] },
  FootR: { parent: "LowerLegR", at: [0, -0.395, 0] },
};

export const BONE_INDEX: Readonly<Record<BoneName, number>> = Object.fromEntries(
  BONE_NAMES.map((name, i) => [name, i]),
) as Record<BoneName, number>;

/** Where a bone sits in model space in the bind pose. */
export function bindPosition(name: BoneName): Vector3 {
  const out = new Vector3();
  let bone: BoneName | null = name;
  while (bone) {
    const spec: (typeof BONE_SPECS)[BoneName] = BONE_SPECS[bone];
    out.add(new Vector3(...spec.at));
    bone = spec.parent;
  }
  return out;
}

/** Height of the model (soles to the top of the hair), metres: about seven heads (#281). */
export const HENCHMAN_HEIGHT = 1.73;
/** Chin to crown, metres. */
export const HEAD_HEIGHT = 0.25;

/** A fresh bone hierarchy and its skeleton (bind matrices from the rest pose). */
export function buildSkeleton(): { root: Bone; bones: Bone[]; skeleton: Skeleton } {
  const bones = BONE_NAMES.map((name) => {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(...BONE_SPECS[name].at);
    return bone;
  });
  for (const name of BONE_NAMES) {
    const parent = BONE_SPECS[name].parent;
    if (parent) bones[BONE_INDEX[parent]]?.add(bones[BONE_INDEX[name]] as Bone);
  }
  const root = bones[BONE_INDEX.Hips] as Bone;
  root.updateMatrixWorld(true);
  return { root, bones, skeleton: new Skeleton(bones) };
}
