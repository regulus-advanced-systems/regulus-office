/**
 * Smooths another human's presence (patched ~20 Hz by the BuildingRoom) into a
 * pose to draw each frame: the avatar is rendered `INTERP_DELAY_MS` in the
 * past and interpolated between the two samples around that time, and
 * extrapolated for a short while when the next sample is late. `moving`
 * drives the walk animation so a remote avatar walks exactly while it moves.
 */
import { lerpHeading, type Pose } from "./kinematics.ts";

/** Render this far behind the newest sample (two server patches at 20 Hz). */
export const INTERP_DELAY_MS = 100;
/** Keep extrapolating along the last velocity for at most this long. */
export const MAX_EXTRAPOLATION_MS = 150;
/** Server patches normally arrive this often; used to bridge gaps after idling. */
export const NOMINAL_PATCH_MS = 50;
/** A gap longer than this means the human stood still, not that a patch was slow. */
export const MAX_GAP_MS = 250;
/** Speeds below this (m/s) read as standing. */
export const MOVING_SPEED_EPS = 0.05;

export interface PoseSample extends Pose {
  /** Local clock (ms) when the sample arrived. */
  readonly t: number;
}

export interface SampledPose extends Pose {
  readonly moving: boolean;
}

export interface PoseBuffer {
  push(sample: PoseSample): void;
  /** Pose to draw at local time `now`, or null before the first sample. */
  sampleAt(now: number): SampledPose | null;
  readonly size: number;
}

export interface PoseBufferOptions {
  delayMs?: number;
  maxExtrapolationMs?: number;
}

function speedBetween(a: PoseSample, b: PoseSample): number {
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return 0;
  return Math.hypot(b.x - a.x, b.z - a.z) / dt;
}

export function createPoseBuffer(options: PoseBufferOptions = {}): PoseBuffer {
  const delay = options.delayMs ?? INTERP_DELAY_MS;
  const maxExtrapolation = options.maxExtrapolationMs ?? MAX_EXTRAPOLATION_MS;
  const samples: PoseSample[] = [];

  return {
    get size() {
      return samples.length;
    },
    push(sample) {
      const last = samples[samples.length - 1];
      if (last && sample.t <= last.t) return;
      // After a quiet spell the previous sample is stale; re-stamp it so the
      // lerp covers one patch interval instead of the whole silence.
      if (last && sample.t - last.t > MAX_GAP_MS) {
        samples.push({ ...last, t: sample.t - NOMINAL_PATCH_MS });
      }
      samples.push(sample);
    },
    sampleAt(now) {
      if (samples.length === 0) return null;
      const renderT = now - delay;
      // Drop samples no longer needed: keep one before renderT.
      while (samples.length > 2 && (samples[1] as PoseSample).t <= renderT) samples.shift();
      const first = samples[0] as PoseSample;
      const last = samples[samples.length - 1] as PoseSample;
      if (renderT <= first.t || samples.length === 1) {
        return { x: first.x, z: first.z, heading: first.heading, moving: false };
      }
      if (renderT >= last.t) {
        const prev = samples[samples.length - 2] as PoseSample;
        const speed = speedBetween(prev, last);
        const ahead = Math.min(renderT - last.t, maxExtrapolation);
        if (speed < MOVING_SPEED_EPS || last.t - prev.t > MAX_GAP_MS) {
          return { x: last.x, z: last.z, heading: last.heading, moving: false };
        }
        const k = ahead / (last.t - prev.t);
        return {
          x: last.x + (last.x - prev.x) * k,
          z: last.z + (last.z - prev.z) * k,
          heading: last.heading,
          moving: renderT - last.t < maxExtrapolation,
        };
      }
      for (let i = 1; i < samples.length; i++) {
        const b = samples[i] as PoseSample;
        if (b.t < renderT) continue;
        const a = samples[i - 1] as PoseSample;
        const span = b.t - a.t;
        const t = span > 0 ? (renderT - a.t) / span : 1;
        return {
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          heading: lerpHeading(a.heading, b.heading, t),
          moving: speedBetween(a, b) >= MOVING_SPEED_EPS,
        };
      }
      return { x: last.x, z: last.z, heading: last.heading, moving: false };
    },
  };
}
