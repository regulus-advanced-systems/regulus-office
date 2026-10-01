/**
 * The send-home walk (#33, SPEC §9.3) as a pure timeline: the henchman stands
 * up from its desk, picks up a box of its things, walks the nav grid to the
 * elevator doors, and steps in (shrinks away). `advance` is called once per
 * frame with the elapsed seconds; with reduced motion (SPEC §11) the plan
 * starts finished, so the henchman simply disappears.
 */

import type { AvatarAnimation } from "@regulus/protocol";
import { type RoomTemplate, seatById, type Vec2 } from "@regulus/room-layout";
import type { Pose } from "../../movement/kinematics.ts";
import { navGridFor, planPath } from "../../movement/navigation.ts";
import { followPath } from "../../movement/pathFollower.ts";

export type SendHomePhase = "stand" | "pickup" | "walk" | "vanish" | "gone";

/** Seconds per timed phase. */
export const PHASE_SECONDS = { stand: 0.6, pickup: 0.8, vanish: 0.5 } as const;
/** A little slower than a human's walk: it is carrying a box. */
export const CARRY_SPEED = 1.8;

export interface SendHomeState {
  phase: SendHomePhase;
  /** Seconds spent in the current phase. */
  elapsed: number;
  pose: Pose;
  /** Waypoints still ahead while walking. */
  path: Vec2[];
  scale: number;
}

export interface SendHomeFrame {
  animation: AvatarAnimation;
  carrying: boolean;
}

/** Where the walk starts: the henchman's seat, else the room centre. */
export function startPose(template: RoomTemplate, seatId: string): Pose {
  const seat = seatById(template, seatId);
  if (seat) return { x: seat.pose.x, z: seat.pose.z, heading: seat.pose.heading };
  return { x: template.size.width / 2, z: template.size.depth / 2, heading: 0 };
}

/** Route from the seat to the elevator doors; a straight line if the grid has none. */
export function routeToElevator(template: RoomTemplate, from: Vec2): Vec2[] {
  const door = template.elevator.door;
  const path = planPath(navGridFor(template), from, door);
  return path && path.length > 0 ? path : [{ x: door.x, z: door.z }];
}

export function planSendHome(
  template: RoomTemplate,
  seatId: string,
  options: { reducedMotion?: boolean } = {},
): SendHomeState {
  const pose = startPose(template, seatId);
  if (options.reducedMotion) return { phase: "gone", elapsed: 0, pose, path: [], scale: 0 };
  return { phase: "stand", elapsed: 0, pose, path: routeToElevator(template, pose), scale: 1 };
}

/** What the avatar shows in a phase. */
export function frameFor(state: SendHomeState): SendHomeFrame {
  switch (state.phase) {
    case "stand":
      return { animation: "idle", carrying: false };
    case "pickup":
      // The box appears halfway through the pick-up.
      return { animation: "point", carrying: state.elapsed >= PHASE_SECONDS.pickup / 2 };
    case "walk":
      return { animation: "walk", carrying: true };
    default:
      return { animation: "idle", carrying: true };
  }
}

/** Advance by `dt` seconds (large steps carry over into the next phases). */
export function advance(state: SendHomeState, dt: number): SendHomeState {
  let next = { ...state, elapsed: state.elapsed + Math.max(0, dt) };
  for (let guard = 0; guard < 8; guard++) {
    switch (next.phase) {
      case "stand":
      case "pickup": {
        const limit = PHASE_SECONDS[next.phase];
        if (next.elapsed < limit) return next;
        next = {
          ...next,
          phase: next.phase === "stand" ? "pickup" : "walk",
          elapsed: next.elapsed - limit,
        };
        break;
      }
      case "walk": {
        const step = followPath(next.pose, next.path, next.elapsed, { speed: CARRY_SPEED });
        if (!step.arrived) return { ...next, pose: step.pose, path: step.path, elapsed: 0 };
        const spent = step.moved / CARRY_SPEED;
        next = {
          ...next,
          pose: step.pose,
          path: [],
          phase: "vanish",
          elapsed: Math.max(0, next.elapsed - spent),
        };
        break;
      }
      case "vanish": {
        if (next.elapsed < PHASE_SECONDS.vanish) {
          return { ...next, scale: 1 - next.elapsed / PHASE_SECONDS.vanish };
        }
        return { ...next, phase: "gone", scale: 0, elapsed: 0 };
      }
      case "gone":
        return next;
    }
  }
  return next;
}
