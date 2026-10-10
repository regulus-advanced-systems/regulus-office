/**
 * Walking or running (#223): which speed the local player moves at, and
 * which gait an avatar shows for a given ground speed. The local player
 * runs while Shift is held (WASD or a click path) or along a path set by a
 * double-click; remote players carry no gait on the wire, so their gait is
 * read from their interpolated speed, with hysteresis and smoothing so a
 * jittery patch stream does not flicker between the two. A coffee buzz
 * (#63) makes both paces a little faster without changing the gait: a
 * buzzed walk stays under the speed at which a remote avatar would be shown
 * running (gait.test.ts keeps that true).
 */
import { BUZZ_SPEED_BOOST } from "@regulus/protocol";
import { RUN_SPEED, WALK_SPEED } from "./kinematics.ts";

export type Gait = "walk" | "run";

export interface SpeedInput {
  /** Shift is held (outside text fields, not in build mode). */
  shift: boolean;
  /** The current click path was set by a double-click. */
  pathRun: boolean;
}

let boost = 1;

/**
 * The coffee buzz (#63): the local player walks and runs this many times as
 * fast while the office says they are buzzed (scene/coffee sets it from
 * their own presence). Never below 1 or above the buzz's own factor, so
 * nothing else can use this to go faster.
 */
export function setSpeedBoost(factor: number): void {
  boost = Number.isFinite(factor) ? Math.min(BUZZ_SPEED_BOOST, Math.max(1, factor)) : 1;
}

export function speedBoost(): number {
  return boost;
}

/** Ground speed for the local player, metres per second (with the buzz, if any). */
export function selectSpeed({ shift, pathRun }: SpeedInput): number {
  return (shift || pathRun ? RUN_SPEED : WALK_SPEED) * boost;
}

/** A remote avatar breaks into a run above this speed (m/s)... */
export const RUN_GAIT_ABOVE = WALK_SPEED + (RUN_SPEED - WALK_SPEED) * 0.55;
/** ...and drops back to a walk below this one. */
export const WALK_GAIT_BELOW = WALK_SPEED + (RUN_SPEED - WALK_SPEED) * 0.35;

/** Gait for a ground speed, keeping `previous` inside the hysteresis band. */
export function gaitForSpeed(speed: number, previous: Gait = "walk"): Gait {
  if (speed >= RUN_GAIT_ABOVE) return "run";
  if (speed < WALK_GAIT_BELOW) return "walk";
  return previous;
}

/** Time constant of the remote speed smoothing, seconds. */
export const GAIT_SMOOTHING_S = 0.15;

export interface GaitTracker {
  /** Feed the current speed estimate and the elapsed time; returns the gait to show. */
  update(speed: number, dt: number): Gait;
  /** Back to a standing walk gait (the avatar stopped). */
  reset(): void;
  readonly gait: Gait;
  readonly speed: number;
}

/** Smooths a noisy speed estimate (exponential, `tau` seconds) into a stable gait. */
export function createGaitTracker(tau: number = GAIT_SMOOTHING_S): GaitTracker {
  let smoothed = 0;
  let gait: Gait = "walk";
  return {
    get gait() {
      return gait;
    },
    get speed() {
      return smoothed;
    },
    update(speed, dt) {
      const k = tau > 0 ? 1 - Math.exp(-Math.max(0, dt) / tau) : 1;
      const target = Number.isFinite(speed) ? Math.max(0, speed) : 0;
      smoothed += (target - smoothed) * k;
      gait = gaitForSpeed(smoothed, gait);
      return gait;
    },
    reset() {
      smoothed = 0;
      gait = "walk";
    },
  };
}
