/**
 * Advance a pose along a list of waypoints at walking speed, turning toward
 * the travel direction with a rate limit. A robot facing well away from its
 * way (more than TURN_IN_PLACE_ABOVE) first turns on the spot and only then
 * sets off, so it always walks face-first (#119). Pure: the store calls it
 * once per frame with the elapsed time and keeps the returned pose and
 * remaining path.
 */
import type { Vec2 } from "@regulus/floor-layout";
import {
  angleDelta,
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

/**
 * Facing off the travel direction by more than this (radians, 45 degrees)
 * turns on the spot before walking; smaller corners are taken on the move.
 */
export const TURN_IN_PLACE_ABOVE = Math.PI / 4;

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
  const ahead = [...path];
  while (ahead.length > 0 && distance({ x, z }, ahead[0] as Vec2) <= REACH_EPS) ahead.shift();
  const first = ahead[0];
  if (!first) return { pose: { x, z, heading }, path: ahead, moved: 0, arrived: true };

  // Turn on the spot until the way ahead is within TURN_IN_PLACE_ABOVE.
  let walkTime = Math.max(0, dt);
  const travel = headingOfTravel(first.x - x, first.z - z);
  const offBy = Math.abs(angleDelta(heading, travel));
  if (offBy > TURN_IN_PLACE_ABOVE) {
    const turnTime = turnRate > 0 ? (offBy - TURN_IN_PLACE_ABOVE) / turnRate : Infinity;
    if (turnTime >= walkTime) {
      heading = turnToward(heading, travel, turnRate * walkTime);
      return { pose: { x, z, heading }, path: ahead, moved: 0, arrived: false };
    }
    heading = turnToward(heading, travel, offBy - TURN_IN_PLACE_ABOVE);
    walkTime -= turnTime;
  }

  let remaining = speed * walkTime;
  let moved = 0;
  while (ahead.length > 0 && remaining > 0) {
    const next = ahead[0] as Vec2;
    const d = distance({ x, z }, next);
    if (d <= REACH_EPS) {
      ahead.shift();
      continue;
    }
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
  heading = turnToward(heading, travel, turnRate * walkTime);
  return { pose: { x, z, heading }, path: ahead, moved, arrived: ahead.length === 0 };
}
