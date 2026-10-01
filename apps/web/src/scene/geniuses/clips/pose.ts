/**
 * Procedural keyframing: a clip is a function from phase (0..1) to a pose,
 * sampled into one quaternion track per bone plus the hips position. Every
 * clip animates every bone, so a crossfade never leaves a stale limb behind.
 */
import {
  AnimationClip,
  Euler,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import { BONES, type Body, type BoneName, boneNodeName, restJoints, type Vec3 } from "../rig.ts";

/**
 * Euler angles in degrees, applied z, then x, then y ("YXZ"): z spreads a
 * hanging limb sideways (+z lifts the left arm out), x pitches it (+x swings
 * it back, -x forward; +x leans the spine forward), y then yaws the result
 * (+y turns a forward-pointing limb toward +x, the character's left).
 */
export type Rot = [number, number, number];

export interface Pose {
  /** Hips position relative to rest (metres), or absolute when `hipsAbsolute`. */
  hips?: Vec3;
  hipsAbsolute?: boolean;
  rot: Partial<Record<BoneName, Rot>>;
}

export type PoseFn = (phase: number) => Pose;

const DEG = Math.PI / 180;
const euler = new Euler();
const quat = new Quaternion();

/** Merge poses left to right: later rotations replace earlier ones bone by bone. */
export function layer(...poses: Pose[]): Pose {
  const out: Pose = { rot: {} };
  for (const pose of poses) {
    if (pose.hips) {
      out.hips = pose.hips;
      out.hipsAbsolute = pose.hipsAbsolute;
    }
    Object.assign(out.rot, pose.rot);
  }
  return out;
}

/** Add `delta` to the rotation of `bone` in `pose` (procedural wobble on top of a held pose). */
export function nudge(pose: Pose, bone: BoneName, delta: Rot): Pose {
  const base = pose.rot[bone] ?? [0, 0, 0];
  pose.rot[bone] = [base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]];
  return pose;
}

/** Sample `fn` into a looping clip of `duration` seconds with `frames` intervals. */
export function sampleClip(
  name: string,
  body: Body,
  duration: number,
  frames: number,
  fn: PoseFn,
): AnimationClip {
  const times: number[] = [];
  const quats = new Map<BoneName, number[]>(BONES.map((b) => [b, []]));
  const hips: number[] = [];
  const rest = restJoints(body).hips;
  for (let i = 0; i <= frames; i++) {
    const phase = i / frames;
    times.push(phase * duration);
    const pose = fn(phase);
    for (const bone of BONES) {
      const [x, y, z] = pose.rot[bone] ?? [0, 0, 0];
      quat.setFromEuler(euler.set(x * DEG, y * DEG, z * DEG, "YXZ"));
      quats.get(bone)?.push(quat.x, quat.y, quat.z, quat.w);
    }
    const h = pose.hips ?? [0, 0, 0];
    if (pose.hipsAbsolute) hips.push(...h);
    else hips.push(rest[0] + h[0], rest[1] + h[1], rest[2] + h[2]);
  }
  const tracks = [
    new VectorKeyframeTrack(`${boneNodeName("hips")}.position`, times, hips),
    ...BONES.map(
      (bone) =>
        new QuaternionKeyframeTrack(
          `${boneNodeName(bone)}.quaternion`,
          times,
          quats.get(bone) ?? [],
        ),
    ),
  ];
  return new AnimationClip(name, duration, tracks);
}

export const TAU = Math.PI * 2;
/** sin of a phase in cycles. */
export const wave = (phase: number, cycles = 1, offset = 0): number =>
  Math.sin(TAU * (phase * cycles + offset));
