/**
 * Seated clips built from robot.glb's own `Robot_Sitting` (#159).
 *
 * `Robot_Sitting` is not a seated loop: it is a 0.42 s sit-down transition
 * (the legs swing about 40° from the squat into the seated pose). Played on
 * loop, as every seated robot and human did, it snapped the legs back and
 * swung them down again about 2.4 times a second: the "shaking" at the desk.
 *
 * The model has no seated idle or typing clip, so these are made here from
 * the last frame of `Robot_Sitting` (the robot at rest in the chair):
 *
 * - `SEATED_CLIPS.idle`: that pose, held. No motion at all.
 * - `SEATED_CLIPS.type`: forearms tapping in turn, the head nodding slightly
 *   toward the laptop.
 * - `SEATED_CLIPS.read`: the head bowed to the papers, scanning side to side.
 * - `SEATED_CLIPS.think`: the head slowly rocking (the procedural tilt of
 *   `think` still applies on top).
 *
 * Every wiggle is a sine whose period divides the clip's duration, so the
 * loops are seamless. Pure: no scene access, safe to unit test.
 */
import {
  AnimationClip,
  type KeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
} from "three";

/** Names of the synthesised clips (not in the GLB, so they cannot clash with its clips). */
export const SEATED_CLIPS = {
  idle: "Seated|Idle",
  type: "Seated|Type",
  read: "Seated|Read",
  think: "Seated|Think",
} as const;

/** One bone's periodic rotation on top of the seated pose, in the bone's local space. */
export interface Wiggle {
  /** Bone (track) name as GLTFLoader sanitises it, e.g. `LowerArmL`. */
  bone: string;
  axis: readonly [number, number, number];
  /** Constant offset, radians. */
  bias: number;
  /** Amplitude of the sine, radians. */
  amp: number;
  /** Seconds; must divide the clip duration. */
  period: number;
  /** Fraction of a period, 0..1. */
  phase: number;
}

export interface SeatedMotion {
  duration: number;
  wiggles: readonly Wiggle[];
}

const X = [1, 0, 0] as const;
const Y = [0, 1, 0] as const;

/** Local-axis motions per synthesised clip (the idle clip has none). */
export const SEATED_MOTIONS: Readonly<
  Record<Exclude<keyof typeof SEATED_CLIPS, "idle">, SeatedMotion>
> = {
  type: {
    duration: 1.2,
    wiggles: [
      { bone: "LowerArmL", axis: X, bias: 0, amp: 0.14, period: 0.3, phase: 0 },
      { bone: "LowerArmR", axis: X, bias: 0, amp: 0.14, period: 0.3, phase: 0.5 },
      { bone: "Head", axis: X, bias: 0.12, amp: 0.03, period: 0.6, phase: 0 },
    ],
  },
  read: {
    duration: 4,
    wiggles: [
      { bone: "Head", axis: X, bias: 0.22, amp: 0.02, period: 2, phase: 0 },
      { bone: "Head", axis: Y, bias: 0, amp: 0.12, period: 4, phase: 0 },
    ],
  },
  think: {
    duration: 4,
    wiggles: [{ bone: "Head", axis: X, bias: -0.06, amp: 0.06, period: 4, phase: 0 }],
  },
};

/** Keys per second of the synthesised loops. */
const KEY_RATE = 30;

/** The value of each of a clip's tracks at its last key. */
export function lastPose(
  clip: AnimationClip,
): Map<string, { track: KeyframeTrack; value: number[] }> {
  const pose = new Map<string, { track: KeyframeTrack; value: number[] }>();
  for (const track of clip.tracks) {
    const size = track.getValueSize();
    const values = Array.from(track.values.slice(track.values.length - size));
    pose.set(track.name, { track, value: values });
  }
  return pose;
}

/** The value of each of a clip's tracks at time `t` (seconds), interpolated. */
export function poseAt(
  clip: AnimationClip,
  t: number,
): Map<string, { track: KeyframeTrack; value: number[] }> {
  const pose = new Map<string, { track: KeyframeTrack; value: number[] }>();
  for (const track of clip.tracks) pose.set(track.name, { track, value: sampleTrack(track, t) });
  return pose;
}

/** A track's value at `t` (linear; quaternions slerped), clamped to its keys. */
export function sampleTrack(track: KeyframeTrack, t: number): number[] {
  const size = track.getValueSize();
  const { times, values } = track;
  const last = times.length - 1;
  const at = (i: number) => Array.from(values.slice(i * size, i * size + size));
  if (last < 0) return [];
  if (t <= (times[0] ?? 0)) return at(0);
  if (t >= (times[last] ?? 0)) return at(last);
  let i = 0;
  while (i < last && (times[i + 1] ?? 0) <= t) i++;
  const t0 = times[i] ?? 0;
  const k = (t - t0) / ((times[i + 1] ?? t0 + 1) - t0);
  if (track instanceof QuaternionKeyframeTrack) {
    const out = [0, 0, 0, 0];
    Quaternion.slerpFlat(
      out,
      0,
      values as unknown as number[],
      i * 4,
      values as unknown as number[],
      (i + 1) * 4,
      k,
    );
    return out;
  }
  const a = at(i);
  const b = at(i + 1);
  return a.map((v, c) => v + ((b[c] ?? v) - v) * k);
}

/** A track that holds one value for `duration` seconds (two identical keys). */
export function holdTrack(track: KeyframeTrack, value: readonly number[], duration: number) {
  const Track = track.constructor as new (
    name: string,
    times: number[],
    values: number[],
  ) => KeyframeTrack;
  return new Track(track.name, [0, duration], [...value, ...value]);
}

/** A clip that holds the given pose (static; loops without a seam). */
export function holdClip(
  name: string,
  pose: ReadonlyMap<string, { track: KeyframeTrack; value: number[] }>,
  duration = 1,
): AnimationClip {
  const tracks = [...pose.values()].map(({ track, value }) => holdTrack(track, value, duration));
  return new AnimationClip(name, duration, tracks);
}

const axisVec = new Vector3();
const offset = new Quaternion();

/** Rotation of the bone's wiggles at time `t`, multiplied onto `base` (local space). */
export function wiggleAt(base: Quaternion, wiggles: readonly Wiggle[], t: number): Quaternion {
  const q = base.clone();
  for (const w of wiggles) {
    const angle = w.bias + w.amp * Math.sin(2 * Math.PI * (t / w.period + w.phase));
    offset.setFromAxisAngle(axisVec.set(w.axis[0], w.axis[1], w.axis[2]), angle);
    q.multiply(offset);
  }
  return q;
}

/** The seated pose with `motion`'s wiggles as a looping clip. */
export function motionClip(
  name: string,
  pose: ReadonlyMap<string, { track: KeyframeTrack; value: number[] }>,
  motion: SeatedMotion,
): AnimationClip {
  const keys = Math.round(motion.duration * KEY_RATE);
  const times = Array.from({ length: keys + 1 }, (_, i) => (i * motion.duration) / keys);
  const tracks: KeyframeTrack[] = [];
  for (const [trackName, { track, value }] of pose) {
    const bone = trackName.replace(/\.quaternion$/, "");
    const wiggles = trackName.endsWith(".quaternion")
      ? motion.wiggles.filter((w) => w.bone === bone)
      : [];
    if (wiggles.length === 0) {
      tracks.push(holdTrack(track, value, motion.duration));
      continue;
    }
    const base = new Quaternion(value[0], value[1], value[2], value[3]);
    const values: number[] = [];
    for (const t of times) {
      const q = wiggleAt(base, wiggles, t);
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new QuaternionKeyframeTrack(trackName, times, values));
  }
  return new AnimationClip(name, motion.duration, tracks);
}

/** A bone's rest rotation (x, y, z, w), from the model's scene graph. */
export type RestRotation = (bone: string) => readonly number[] | undefined;

/**
 * The seated pose: the last frame of the sit-down clip, plus the rest
 * rotation of every bone a seated clip moves that the sit-down clip does not
 * (`Robot_Sitting` has no head track). Every seated clip then has the same
 * tracks, so switching between them never leaves a bone where the last one
 * put it.
 */
export function seatedPose(
  sitting: AnimationClip,
  rest: RestRotation,
): Map<string, { track: KeyframeTrack; value: number[] }> {
  const pose = lastPose(sitting);
  const moved = new Set(Object.values(SEATED_MOTIONS).flatMap((m) => m.wiggles.map((w) => w.bone)));
  for (const bone of moved) {
    const name = `${bone}.quaternion`;
    const value = rest(bone);
    if (pose.has(name) || !value || value.length !== 4) continue;
    pose.set(name, {
      track: new QuaternionKeyframeTrack(name, [0], [...value]),
      value: [...value],
    });
  }
  return pose;
}

/** All seated clips, built from the GLB's sit-down clip and the model's rest pose. */
export function seatedClips(sitting: AnimationClip, rest: RestRotation): AnimationClip[] {
  const pose = seatedPose(sitting, rest);
  return [
    holdClip(SEATED_CLIPS.idle, pose),
    motionClip(SEATED_CLIPS.type, pose, SEATED_MOTIONS.type),
    motionClip(SEATED_CLIPS.read, pose, SEATED_MOTIONS.read),
    motionClip(SEATED_CLIPS.think, pose, SEATED_MOTIONS.think),
  ];
}
