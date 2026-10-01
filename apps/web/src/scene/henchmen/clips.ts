/**
 * The henchman's animation clips (#184), keyframed in code from the poses in
 * poses.ts, and which clip plays for each avatar animation (SPEC §9.3).
 *
 * Every full clip has a rotation track for every bone and the Hips position,
 * so a crossfade never strands a bone where the last clip put it. Two
 * partial clips (the raised hand and the carry) only have arm tracks and are
 * blended over the base clip at a high weight (HenchmanAvatar).
 *
 * Seated clips start from the same still pose (`SIT_IDLE`); the merge-gong
 * cheer (#202) starts and ends in it, so a henchman sits back exactly as it was.
 * Loops are seamless: every key sequence ends where it starts and every
 * wiggle's period divides the clip's duration.
 */
import type { AvatarAnimation } from "@regulus/protocol";
import {
  AnimationClip,
  Euler,
  type KeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import {
  ARMS_UP,
  CARRY,
  CHIN_IN_HAND,
  type Deg3,
  HAND_UP,
  HOLD_PAPERS,
  merge,
  PALM_ON_FACE,
  POINTING,
  type Pose,
  SIT,
  SIT_IDLE,
  SIT_TYPE,
  STAND,
  STAND_HIPS_Y,
} from "./poses.ts";
import { BONE_NAMES, BONE_SPECS, type BoneName } from "./rig.ts";

export const HENCHMAN_CLIPS = {
  idle: "Henchman|Idle",
  walk: "Henchman|Walk",
  read: "Henchman|Read",
  think: "Henchman|Think",
  celebrate: "Henchman|Celebrate",
  facepalm: "Henchman|Facepalm",
  wave: "Henchman|Wave",
  point: "Henchman|Point",
  sitIdle: "Henchman|SitIdle",
  sitType: "Henchman|SitType",
  sitRead: "Henchman|SitRead",
  sitThink: "Henchman|SitThink",
  sitCheer: "Henchman|SitCheer",
  hand: "Henchman|Hand",
  carry: "Henchman|Carry",
} as const;
export type HenchmanClipName = (typeof HENCHMAN_CLIPS)[keyof typeof HENCHMAN_CLIPS];

/**
 * Weight of the partial arm clips (raised hand, carry) over the base clip:
 * the mixer averages by weight, so 40:1 puts the arm 97.5% in the held pose.
 */
export const ARM_OVERLAY_WEIGHT = 40;

/** A periodic rotation on top of the keyed pose (bone-local, degrees). */
interface Wiggle {
  bone: BoneName;
  axis: 0 | 1 | 2;
  amp: number;
  /** Cycles over the clip (an integer, so the loop is seamless). */
  cycles: number;
  phase?: number;
}

interface ClipSpec {
  name: HenchmanClipName;
  duration: number;
  /** [time 0..1 of the duration, pose]; the first key must be at 0. */
  keys: ReadonlyArray<readonly [number, Pose]>;
  wiggles?: readonly Wiggle[];
  /** Hips bob: [amplitude m, cycles]. */
  bob?: readonly [number, number];
  /** Only these bones get tracks (partial clips). */
  bones?: readonly BoneName[];
}

const KEY_RATE = 30;
const toRad = Math.PI / 180;
const euler = new Euler();

function rotationAt(spec: ClipSpec, bone: BoneName, t: number, out: Quaternion): Quaternion {
  const k = t / spec.duration;
  const keys = spec.keys;
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1]?.[0] ?? 1) <= k) i++;
  const [k0, p0] = keys[i] ?? [0, {}];
  const [k1, p1] = keys[i + 1] ?? [1, keys[0]?.[1] ?? {}];
  const a = p0[bone] ?? [0, 0, 0];
  const b = p1[bone] ?? [0, 0, 0];
  // Ease in and out between keys.
  const raw = k1 > k0 ? Math.min(1, Math.max(0, (k - k0) / (k1 - k0))) : 0;
  const s = raw * raw * (3 - 2 * raw);
  const angles = [0, 1, 2].map((c) => (a[c] ?? 0) + ((b[c] ?? 0) - (a[c] ?? 0)) * s) as [
    number,
    number,
    number,
  ];
  for (const w of spec.wiggles ?? [])
    if (w.bone === bone)
      angles[w.axis] += w.amp * Math.sin(2 * Math.PI * (w.cycles * k + (w.phase ?? 0)));
  euler.set(angles[0] * toRad, angles[1] * toRad, angles[2] * toRad);
  return out.setFromEuler(euler);
}

function hipsYAt(spec: ClipSpec, t: number): number {
  const k = t / spec.duration;
  const keys = spec.keys;
  let i = 0;
  while (i < keys.length - 1 && (keys[i + 1]?.[0] ?? 1) <= k) i++;
  const [k0, p0] = keys[i] ?? [0, {}];
  const [k1, p1] = keys[i + 1] ?? [1, keys[0]?.[1] ?? {}];
  const raw = k1 > k0 ? Math.min(1, Math.max(0, (k - k0) / (k1 - k0))) : 0;
  const s = raw * raw * (3 - 2 * raw);
  const a = p0.hipsY ?? STAND_HIPS_Y;
  const b = p1.hipsY ?? STAND_HIPS_Y;
  const bob = spec.bob ? spec.bob[0] * Math.abs(Math.sin(Math.PI * spec.bob[1] * k)) : 0;
  return a + (b - a) * s + bob;
}

/** Bake a spec into a clip: 30 keys a second (two keys when nothing moves). */
export function buildClip(spec: ClipSpec): AnimationClip {
  const still = spec.keys.length === 1 && !spec.wiggles?.length && !spec.bob;
  const n = still ? 1 : Math.max(2, Math.round(spec.duration * KEY_RATE));
  const times = Array.from({ length: n + 1 }, (_, i) => (i * spec.duration) / n);
  const bones = spec.bones ?? BONE_NAMES;
  const tracks: KeyframeTrack[] = [];
  const q = new Quaternion();
  for (const bone of bones) {
    const values: number[] = [];
    for (const t of times) {
      rotationAt(spec, bone, t, q);
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  if (!spec.bones) {
    const [hx, , hz] = BONE_SPECS.Hips.at;
    const values = times.flatMap((t) => [hx, hipsYAt(spec, t), hz]);
    tracks.push(new VectorKeyframeTrack("Hips.position", times, values));
  }
  return new AnimationClip(spec.name, spec.duration, tracks);
}

const add = (pose: Pose, deltas: Partial<Record<BoneName, Deg3>>): Pose => {
  const out: Record<string, unknown> = { ...pose };
  for (const [bone, d] of Object.entries(deltas) as Array<[BoneName, Deg3]>) {
    const base = pose[bone] ?? [0, 0, 0];
    out[bone] = [base[0] + d[0], base[1] + d[1], base[2] + d[2]];
  }
  return out as Pose;
};

const WALK_A = add(STAND, {
  UpperLegL: [-28, 0, 0],
  UpperLegR: [24, 0, 0],
  LowerLegL: [8, 0, 0],
  LowerLegR: [22, 0, 0],
  UpperArmL: [26, 0, 0],
  UpperArmR: [-26, 0, 0],
  Body: [0, 6, 0],
});
const WALK_B = add(STAND, {
  UpperLegL: [24, 0, 0],
  UpperLegR: [-28, 0, 0],
  LowerLegL: [22, 0, 0],
  LowerLegR: [8, 0, 0],
  UpperArmL: [-26, 0, 0],
  UpperArmR: [26, 0, 0],
  Body: [0, -6, 0],
});

const SIT_READ = merge(SIT, HOLD_PAPERS, { Head: [22, 0, 0] });
const SIT_THINK = merge(SIT, CHIN_IN_HAND, { Head: [-4, 0, 0] });
const SIT_CHEER_UP = merge(SIT_IDLE, ARMS_UP, { Head: [-12, 0, 0] });

export const CLIP_SPECS: readonly ClipSpec[] = [
  {
    name: HENCHMAN_CLIPS.idle,
    duration: 3,
    keys: [[0, STAND]],
    wiggles: [
      { bone: "Body", axis: 0, amp: 1.5, cycles: 1 },
      { bone: "Head", axis: 1, amp: 4, cycles: 1, phase: 0.25 },
    ],
  },
  {
    name: HENCHMAN_CLIPS.walk,
    duration: 0.9,
    keys: [
      [0, WALK_A],
      [0.5, WALK_B],
    ],
    bob: [0.025, 2],
  },
  {
    name: HENCHMAN_CLIPS.read,
    duration: 4,
    keys: [[0, merge(STAND, HOLD_PAPERS, { Head: [20, 0, 0] })]],
    wiggles: [{ bone: "Head", axis: 1, amp: 9, cycles: 1 }],
  },
  {
    name: HENCHMAN_CLIPS.think,
    duration: 4,
    keys: [[0, merge(STAND, CHIN_IN_HAND)]],
    wiggles: [{ bone: "Body", axis: 1, amp: 4, cycles: 1 }],
  },
  {
    name: HENCHMAN_CLIPS.celebrate,
    duration: 1.2,
    keys: [
      [0, merge(STAND, ARMS_UP, { hipsY: STAND_HIPS_Y })],
      [0.3, merge(STAND, ARMS_UP, { UpperLegL: [-30, 0, 0], LowerLegL: [50, 0, 0] })],
      [0.5, merge(STAND, ARMS_UP, { hipsY: STAND_HIPS_Y })],
      [0.8, merge(STAND, ARMS_UP, { UpperLegR: [-30, 0, 0], LowerLegR: [50, 0, 0] })],
    ],
    bob: [0.09, 2],
    wiggles: [
      { bone: "LowerArmL", axis: 0, amp: 25, cycles: 2 },
      { bone: "LowerArmR", axis: 0, amp: 25, cycles: 2, phase: 0.5 },
    ],
  },
  {
    name: HENCHMAN_CLIPS.facepalm,
    duration: 2.5,
    keys: [
      [0, STAND],
      [0.25, merge(STAND, PALM_ON_FACE)],
      [0.85, merge(STAND, PALM_ON_FACE, { Head: [28, 0, 0] })],
    ],
    wiggles: [{ bone: "Head", axis: 1, amp: 8, cycles: 2 }],
  },
  {
    name: HENCHMAN_CLIPS.wave,
    duration: 1.2,
    keys: [[0, merge(STAND, { UpperArmR: [-10, 0, -150], LowerArmR: [-20, 0, 0] })]],
    wiggles: [{ bone: "LowerArmR", axis: 2, amp: 28, cycles: 2 }],
  },
  {
    name: HENCHMAN_CLIPS.point,
    duration: 2,
    keys: [[0, merge(STAND, POINTING)]],
    wiggles: [{ bone: "UpperArmR", axis: 0, amp: 3, cycles: 1 }],
  },
  { name: HENCHMAN_CLIPS.sitIdle, duration: 1, keys: [[0, SIT_IDLE]] },
  {
    name: HENCHMAN_CLIPS.sitType,
    duration: 1.2,
    keys: [[0, SIT_TYPE]],
    wiggles: [
      { bone: "LowerArmL", axis: 0, amp: 9, cycles: 4 },
      { bone: "LowerArmR", axis: 0, amp: 9, cycles: 4, phase: 0.5 },
      { bone: "HandL", axis: 0, amp: 8, cycles: 4, phase: 0.25 },
      { bone: "HandR", axis: 0, amp: 8, cycles: 4, phase: 0.75 },
      { bone: "Head", axis: 0, amp: 2, cycles: 2 },
    ],
  },
  {
    name: HENCHMAN_CLIPS.sitRead,
    duration: 4,
    keys: [[0, SIT_READ]],
    wiggles: [{ bone: "Head", axis: 1, amp: 9, cycles: 1 }],
  },
  {
    name: HENCHMAN_CLIPS.sitThink,
    duration: 4,
    keys: [[0, SIT_THINK]],
    wiggles: [{ bone: "Head", axis: 0, amp: 4, cycles: 1 }],
  },
  {
    // The merge gong (#43, #202): arms up and pumping, the upper body swaying, legs still.
    name: HENCHMAN_CLIPS.sitCheer,
    duration: 3,
    keys: [
      [0, SIT_IDLE],
      [0.12, SIT_CHEER_UP],
      [0.88, SIT_CHEER_UP],
    ],
    wiggles: [
      { bone: "Abdomen", axis: 2, amp: 9, cycles: 4 },
      { bone: "LowerArmL", axis: 0, amp: 30, cycles: 6 },
      { bone: "LowerArmR", axis: 0, amp: 30, cycles: 6, phase: 0.5 },
      { bone: "Head", axis: 2, amp: 6, cycles: 4, phase: 0.5 },
    ],
  },
  {
    name: HENCHMAN_CLIPS.hand,
    duration: 1,
    keys: [[0, HAND_UP]],
    bones: ["UpperArmR", "LowerArmR", "HandR"],
  },
  {
    name: HENCHMAN_CLIPS.carry,
    duration: 1,
    keys: [[0, CARRY]],
    bones: ["UpperArmL", "UpperArmR", "LowerArmL", "LowerArmR"],
  },
];

let built: AnimationClip[] | undefined;

/** Every henchman clip, built once (all henchmen share them). */
export function henchmanClips(): AnimationClip[] {
  built ??= CLIP_SPECS.map(buildClip);
  return built;
}

/** Standing clip per animation; sit_* stand-ins are the seated clips. */
const STANDING: Readonly<Record<AvatarAnimation, HenchmanClipName>> = {
  idle: HENCHMAN_CLIPS.idle,
  walk: HENCHMAN_CLIPS.walk,
  sit_type: HENCHMAN_CLIPS.sitType,
  sit_idle: HENCHMAN_CLIPS.sitIdle,
  read: HENCHMAN_CLIPS.read,
  think: HENCHMAN_CLIPS.think,
  celebrate: HENCHMAN_CLIPS.celebrate,
  facepalm: HENCHMAN_CLIPS.facepalm,
  wave: HENCHMAN_CLIPS.wave,
  point: HENCHMAN_CLIPS.point,
};

/** Seated clip per animation: the chair versions of read and think, else the still pose. */
const SEATED: Readonly<Partial<Record<AvatarAnimation, HenchmanClipName>>> = {
  sit_type: HENCHMAN_CLIPS.sitType,
  sit_idle: HENCHMAN_CLIPS.sitIdle,
  read: HENCHMAN_CLIPS.sitRead,
  think: HENCHMAN_CLIPS.sitThink,
};

/**
 * The clip a henchman plays: the seated cheer while a seated henchman cheers for
 * the merge gong, else its animation's clip, seated or standing. When the
 * cheer ends the henchman crossfades back to exactly the seated clip it had.
 */
export function henchmanClip(
  animation: AvatarAnimation,
  seated: boolean,
  cheer = false,
): HenchmanClipName {
  if (seated && cheer) return HENCHMAN_CLIPS.sitCheer;
  if (seated) return SEATED[animation] ?? HENCHMAN_CLIPS.sitIdle;
  return STANDING[animation];
}
