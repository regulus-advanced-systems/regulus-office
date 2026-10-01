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
  Hips: { parent: null, at: [0, 0.62, 0] },
  Abdomen: { parent: "Hips", at: [0, 0.12, 0] },
  Body: { parent: "Abdomen", at: [0, 0.18, 0] },
  Neck: { parent: "Body", at: [0, 0.24, 0] },
  Head: { parent: "Neck", at: [0, 0.07, 0] },
  UpperArmL: { parent: "Body", at: [0.3, 0.17, 0] },
  LowerArmL: { parent: "UpperArmL", at: [0, -0.25, 0] },
  HandL: { parent: "LowerArmL", at: [0, -0.22, 0] },
  UpperArmR: { parent: "Body", at: [-0.3, 0.17, 0] },
  LowerArmR: { parent: "UpperArmR", at: [0, -0.25, 0] },
  HandR: { parent: "LowerArmR", at: [0, -0.22, 0] },
  UpperLegL: { parent: "Hips", at: [0.11, -0.03, 0] },
  LowerLegL: { parent: "UpperLegL", at: [0, -0.25, 0] },
  FootL: { parent: "LowerLegL", at: [0, -0.24, 0] },
  UpperLegR: { parent: "Hips", at: [-0.11, -0.03, 0] },
  LowerLegR: { parent: "UpperLegR", at: [0, -0.25, 0] },
  FootR: { parent: "LowerLegR", at: [0, -0.24, 0] },
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

/** Height of the model (feet to helmet top), metres. */
export const HENCHMAN_HEIGHT = 1.62;

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
