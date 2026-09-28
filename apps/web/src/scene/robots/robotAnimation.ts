/**
 * What a robot at its desk does (SPEC §9.3): `RobotState.status` + `.action`
 * → avatar animation, whether it stays seated, and the extras around it
 * (papers while reading, spin + confetti when done). Pure; the RobotLayer
 * applies it.
 *
 * - working: typing / editing / running tests → sit_type; reading / browsing
 *   → read (seated, with papers); thinking → think (seated, head tilt);
 * - failing (action) or error (status) → facepalm; celebrating or done →
 *   celebrate (stands up, spins, confetti). Both are one-shots: after
 *   `ONE_SHOT_MS` the robot sits back down (`settleOneShot`);
 * - everything else (starting, idle, waiting, exited, offline) → sit_idle.
 *   Waiting robots raise a hand on top (`handRaised`).
 */
import type { AgentAction, AgentStatus, AvatarAnimation, RobotState } from "@regulus/protocol";

const WORKING_ACTIONS: Readonly<Record<AgentAction, AvatarAnimation>> = {
  none: "sit_type",
  typing: "sit_type",
  editing: "sit_type",
  running_tests: "sit_type",
  reading: "read",
  browsing: "read",
  thinking: "think",
  failing: "facepalm",
  celebrating: "celebrate",
};

/** Statuses in which the robot is not doing anything visible at the desk. */
const QUIET_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "starting",
  "waiting_permission",
  "waiting_input",
  "exited",
  "offline",
]);

export function robotAnimationFor(robot: Pick<RobotState, "status" | "action">): AvatarAnimation {
  const { status, action } = robot;
  if (status === "error") return "facepalm";
  if (status === "done") return "celebrate";
  if (QUIET_STATUSES.has(status)) return "sit_idle";
  if (status === "working") return WORKING_ACTIONS[action];
  // idle: only the one-shot actions show.
  if (action === "failing") return "facepalm";
  if (action === "celebrating") return "celebrate";
  return "sit_idle";
}

/** Animations a robot plays in its chair. The others stand up at the seat. */
export const SEATED_ROBOT_ANIMATIONS: ReadonlySet<AvatarAnimation> = new Set([
  "sit_type",
  "sit_idle",
  "read",
  "think",
]);

/** How long the one-shot animations play before the robot sits back down. */
export const ONE_SHOT_MS: Readonly<Partial<Record<AvatarAnimation, number>>> = {
  celebrate: 4000,
  facepalm: 2500,
};

/**
 * The animation to show `now`, given when the current one started: one-shots
 * give way to `sit_idle` once their time is up.
 */
export function settleOneShot(
  animation: AvatarAnimation,
  startedAt: number,
  now: number,
): AvatarAnimation {
  const limit = ONE_SHOT_MS[animation];
  return limit !== undefined && now - startedAt >= limit ? "sit_idle" : animation;
}

export interface RobotLook {
  animation: AvatarAnimation;
  seated: boolean;
  /** Papers in hand (reading). */
  papers: boolean;
  /** Spin on the spot (celebrating). */
  spin: boolean;
}

export function robotLookFor(animation: AvatarAnimation): RobotLook {
  return {
    animation,
    seated: SEATED_ROBOT_ANIMATIONS.has(animation),
    papers: animation === "read",
    spin: animation === "celebrate",
  };
}

/** A status transition that should burst confetti (reduced motion permitting). */
export function celebrates(
  prev: Pick<RobotState, "status" | "action"> | undefined,
  next: Pick<RobotState, "status" | "action">,
): boolean {
  if (!prev) return false;
  return robotAnimationFor(next) === "celebrate" && robotAnimationFor(prev) !== "celebrate";
}

/** A transition into a raised hand: play the ding. */
export function raisesHand(
  prev: Pick<RobotState, "handRaised"> | undefined,
  next: Pick<RobotState, "handRaised">,
): boolean {
  return prev !== undefined && !prev.handRaised && next.handRaised;
}
