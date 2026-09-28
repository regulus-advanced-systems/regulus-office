/**
 * Rate-limits `move` commands to the server (SPEC §6, research 01 §2: the
 * BuildingRoom accepts at most 20 Hz per client). A pose is sent only when it
 * differs from the last one sent; a change that lands inside the cool-down is
 * held and sent at the next tick so the final resting pose is never dropped.
 */
import type { Pose } from "./kinematics.ts";

export const MOVE_SEND_HZ = 20;
/** Poses closer than this (metres / radians) count as unchanged. */
const POSE_EPS = 1e-4;

export interface MoveThrottleOptions {
  send: (pose: Pose) => void;
  hz?: number;
  now?: () => number;
}

export interface MoveThrottle {
  /** Record the latest pose; nothing is sent until `tick`. */
  update(pose: Pose): void;
  /** Send the pending pose when the cool-down has elapsed. Returns true when sent. */
  tick(): boolean;
  /** Forget the last sent pose so the next tick re-sends (after a reconnect). */
  reset(): void;
}

export function samePose(a: Pose | null, b: Pose): boolean {
  if (!a) return false;
  return (
    Math.abs(a.x - b.x) < POSE_EPS &&
    Math.abs(a.z - b.z) < POSE_EPS &&
    Math.abs(a.heading - b.heading) < POSE_EPS
  );
}

export function createMoveThrottle(options: MoveThrottleOptions): MoveThrottle {
  const interval = 1000 / (options.hz ?? MOVE_SEND_HZ);
  const now = options.now ?? (() => performance.now());
  let lastSent: Pose | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: Pose | null = null;

  return {
    update(pose) {
      pending = samePose(lastSent, pose) ? null : { x: pose.x, z: pose.z, heading: pose.heading };
    },
    tick() {
      if (!pending) return false;
      const t = now();
      if (t - lastSentAt < interval) return false;
      options.send(pending);
      lastSent = pending;
      lastSentAt = t;
      pending = null;
      return true;
    },
    reset() {
      lastSent = null;
      lastSentAt = Number.NEGATIVE_INFINITY;
    },
  };
}
