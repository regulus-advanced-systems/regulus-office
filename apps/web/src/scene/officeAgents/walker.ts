/**
 * One office agent's body on this client (#252). The server publishes where
 * it is going (`OfficeAgentBody.target`); the walker plans a path there over
 * the viewer's own nav grid and walks it face-first at the body's speed, so a
 * still body costs nothing per frame and the wire carries no positions.
 *
 * A target in a room this viewer cannot see into (its door is shut on their
 * grid) is walked to as far as the door, where the body goes out of sight;
 * it comes back into sight at that door when it is sent somewhere else. A
 * `hop` (first sight, a change of level) puts it at the target at once. Pure:
 * no three.js, no stores.
 */
import {
  OFFICE_AGENT_RUN_ABOVE,
  OFFICE_AGENT_RUN_SPEED,
  OFFICE_AGENT_WALK_SPEED,
} from "@regulus/protocol";
import type { NavGrid, Vec2 } from "@regulus/room-layout";
import { angleDelta, type Pose, TURN_RATE, turnToward } from "../movement/kinematics.ts";
import { nearestWalkable, planPath } from "../movement/navigation.ts";
import { followPath } from "../movement/pathFollower.ts";

export interface WalkTarget extends Pose {
  /** Counts placements (protocol `OfficeAgentBody.hop`). */
  hop: number;
  /** Where to stop instead when the target is somewhere this viewer cannot see into: its door. */
  door: Vec2 | null;
}

export interface BodyWalker {
  readonly pose: Pose;
  /** Walking or turning this frame. */
  readonly moving: boolean;
  readonly running: boolean;
  /** Inside a room this viewer cannot see into. */
  readonly hidden: boolean;
  /** Metres still to walk. */
  readonly remaining: number;
  /** A new target from the server (or a new grid). */
  retarget(grid: NavGrid, target: WalkTarget): void;
  /** Advance by `dt` seconds. Returns true when the pose changed. */
  step(dt: number): boolean;
}

const pathLength = (from: Vec2, path: readonly Vec2[]): number => {
  let total = 0;
  let at = from;
  for (const p of path) {
    total += Math.hypot(p.x - at.x, p.z - at.z);
    at = p;
  }
  return total;
};

export function createBodyWalker(): BodyWalker {
  const pose = { x: 0, z: 0, heading: 0 };
  let path: Vec2[] = [];
  let finalHeading = 0;
  let hop = -1;
  let moving = false;
  let running = false;
  let hidden = false;
  /** Goes out of sight when it gets there. */
  let vanishes = false;
  let remaining = 0;

  const place = (grid: NavGrid, at: Pose) => {
    const spot = nearestWalkable(grid, at) ?? at;
    pose.x = spot.x;
    pose.z = spot.z;
    pose.heading = at.heading;
    path = [];
    remaining = 0;
    moving = false;
    running = false;
  };

  return {
    pose,
    get moving() {
      return moving;
    },
    get running() {
      return running;
    },
    get hidden() {
      return hidden;
    },
    get remaining() {
      return remaining;
    },

    retarget(grid, target) {
      const goal: Pose = target.door
        ? { x: target.door.x, z: target.door.z, heading: target.heading }
        : target;
      finalHeading = goal.heading;
      vanishes = target.door !== null;
      if (target.hop !== hop) {
        // Placed, not walked: first sight, or it changed level.
        hop = target.hop;
        place(grid, goal);
        hidden = vanishes;
        return;
      }
      const planned = planPath(grid, pose, goal);
      if (!planned) {
        // No way there on this viewer's grid: be there rather than walk through walls.
        place(grid, goal);
        hidden = vanishes;
        return;
      }
      path = planned;
      remaining = pathLength(pose, path);
      // Coming out of a room we could not see into: it appears at the door it left by.
      if (path.length > 0) hidden = false;
      else hidden = vanishes;
      running = remaining > OFFICE_AGENT_RUN_ABOVE;
    },

    step(dt) {
      if (path.length === 0) {
        // Arrived: turn to face the way the server says, then rest.
        const off = angleDelta(pose.heading, finalHeading);
        if (Math.abs(off) < 0.01 || vanishes) {
          if (moving) {
            moving = false;
            return true;
          }
          return false;
        }
        pose.heading = turnToward(pose.heading, finalHeading, TURN_RATE * 0.5 * dt);
        moving = false;
        return true;
      }
      const result = followPath(pose, path, dt, {
        speed: running ? OFFICE_AGENT_RUN_SPEED : OFFICE_AGENT_WALK_SPEED,
      });
      pose.x = result.pose.x;
      pose.z = result.pose.z;
      pose.heading = result.pose.heading;
      path = result.path;
      remaining = Math.max(0, remaining - result.moved);
      // Slow to a walk for the last stretch.
      if (running && remaining < OFFICE_AGENT_RUN_ABOVE * 0.4) running = false;
      moving = result.moved > 0;
      if (result.arrived) {
        moving = false;
        running = false;
        remaining = 0;
        if (vanishes) hidden = true;
      }
      return true;
    },
  };
}
