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
 *   `ONE_SHOT_MS` the robot sits back down (animationSettle.ts);
 * - everything else (starting, idle, waiting, exited, offline) → sit_idle,
 *   which is a still seated pose (#159). A robot waiting for permission
 *   raises a hand on top (`raisedHandFor`), and is otherwise still.
 *
 * With reduced motion every robot is still in its chair (`calmFor`); the
 * antenna bulb still tells the status.
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

/** Seated and still: the pose of every robot that is not working (#159). */
export const STILL: AvatarAnimation = "sit_idle";

/** The animation to play: with reduced motion the robot stays still in its chair. */
export function calmFor(animation: AvatarAnimation, reducedMotion: boolean): AvatarAnimation {
  return reducedMotion ? STILL : animation;
}

/**
 * Whether the avatar raises its hand: only while waiting for permission
 * (#159). `waiting_input` sits still like idle, although `RobotState.handRaised`
 * (and the ding) covers it too.
 */
export function raisedHandFor(robot: Pick<RobotState, "status" | "handRaised">): boolean {
  return robot.status === "waiting_permission" && robot.handRaised;
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

/** A transition into a raised hand: play the ding. */
export function raisesHand(
  prev: Pick<RobotState, "handRaised"> | undefined,
  next: Pick<RobotState, "handRaised">,
): boolean {
  return prev !== undefined && !prev.handRaised && next.handRaised;
}
