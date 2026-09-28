/**
 * Advance a pose along a list of waypoints at walking speed, turning toward
 * the travel direction with a rate limit. Pure: the store calls it once per
 * frame with the elapsed time and keeps the returned pose and remaining path.
 */
import type { Vec2 } from "@regulus/floor-layout";
import {
  distance,
  headingOfTravel,
  type Pose,
  TURN_RATE,
  turnToward,
  WALK_SPEED,
} from "./kinematics.ts";

export interface FollowOptions {
  speed?: number;
  turnRate?: number;
}

export interface FollowResult {
  pose: Pose;
  /** Waypoints still ahead; empty once arrived. */
  path: Vec2[];
  /** Distance actually covered this step. */
  moved: number;
  arrived: boolean;
}

/** Waypoints closer than this to the pose count as reached. */
const REACH_EPS = 1e-4;

export function followPath(
  pose: Pose,
  path: readonly Vec2[],
  dt: number,
  options: FollowOptions = {},
): FollowResult {
  const speed = options.speed ?? WALK_SPEED;
  const turnRate = options.turnRate ?? TURN_RATE;
  let x = pose.x;
  let z = pose.z;
  let heading = pose.heading;
  let remaining = Math.max(0, speed * dt);
  let moved = 0;
  const ahead = [...path];
  let firstDir: Vec2 | null = null;

  while (ahead.length > 0 && remaining > 0) {
    const next = ahead[0] as Vec2;
    const d = distance({ x, z }, next);
    if (d <= REACH_EPS) {
      ahead.shift();
      continue;
    }
    if (!firstDir) firstDir = { x: next.x - x, z: next.z - z };
    if (d <= remaining) {
      x = next.x;
      z = next.z;
      remaining -= d;
      moved += d;
      ahead.shift();
    } else {
      x += ((next.x - x) / d) * remaining;
      z += ((next.z - z) / d) * remaining;
      moved += remaining;
      remaining = 0;
    }
  }
  if (firstDir)
    heading = turnToward(heading, headingOfTravel(firstDir.x, firstDir.z), turnRate * dt);
  return { pose: { x, z, heading }, path: ahead, moved, arrived: ahead.length === 0 };
}
