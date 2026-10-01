/**
 * What a henchman at its desk does (SPEC §9.3): `HenchmanState.status` + `.action`
 * → avatar animation, whether it stays seated, and the extras around it
 * (papers while reading, spin + confetti when done). Pure; the HenchmanLayer
 * applies it.
 *
 * - working: typing / editing / running tests → sit_type; reading / browsing
 *   → read (seated, with papers); thinking → think (seated, head tilt);
 * - failing (action) or error (status) → facepalm; celebrating or done →
 *   celebrate (stands up, spins, confetti). Both are one-shots: after
 *   `ONE_SHOT_MS` the henchman sits back down (animationSettle.ts);
 * - everything else (starting, idle, waiting, exited, offline) → sit_idle,
 *   which is a still seated pose (#159). A henchman waiting for permission
 *   raises a hand on top (`raisedHandFor`), and is otherwise still.
 *
 * With reduced motion every henchman is still in its chair (`calmFor`); the
 * antenna bulb still tells the status.
 */
import type { AgentAction, AgentStatus, AvatarAnimation, HenchmanState } from "@regulus/protocol";

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

/** Statuses in which the henchman is not doing anything visible at the desk. */
const QUIET_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "starting",
  "waiting_permission",
  "waiting_input",
  "exited",
  "offline",
]);

export function henchmanAnimationFor(
  henchman: Pick<HenchmanState, "status" | "action">,
): AvatarAnimation {
  const { status, action } = henchman;
  if (status === "error") return "facepalm";
  if (status === "done") return "celebrate";
  if (QUIET_STATUSES.has(status)) return "sit_idle";
  if (status === "working") return WORKING_ACTIONS[action];
  // idle: only the one-shot actions show.
  if (action === "failing") return "facepalm";
  if (action === "celebrating") return "celebrate";
  return "sit_idle";
}

/** Animations a henchman plays in its chair. The others stand up at the seat. */
export const SEATED_HENCHMAN_ANIMATIONS: ReadonlySet<AvatarAnimation> = new Set([
  "sit_type",
  "sit_idle",
  "read",
  "think",
]);

/** How long the one-shot animations play before the henchman sits back down. */
export const ONE_SHOT_MS: Readonly<Partial<Record<AvatarAnimation, number>>> = {
  celebrate: 4000,
  facepalm: 2500,
};

/** Seated and still: the pose of every henchman that is not working (#159). */
export const STILL: AvatarAnimation = "sit_idle";

/** The animation to play: with reduced motion the henchman stays still in its chair. */
export function calmFor(animation: AvatarAnimation, reducedMotion: boolean): AvatarAnimation {
  return reducedMotion ? STILL : animation;
}

/**
 * Whether the avatar raises its hand: only while waiting for permission
 * (#159). `waiting_input` sits still like idle, although `HenchmanState.handRaised`
 * (and the ding) covers it too.
 */
export function raisedHandFor(henchman: Pick<HenchmanState, "status" | "handRaised">): boolean {
  return henchman.status === "waiting_permission" && henchman.handRaised;
}

export interface HenchmanLook {
  animation: AvatarAnimation;
  seated: boolean;
  /** Papers in hand (reading). */
  papers: boolean;
  /** Spin on the spot (celebrating). */
  spin: boolean;
}

export function henchmanLookFor(animation: AvatarAnimation): HenchmanLook {
  return {
    animation,
    seated: SEATED_HENCHMAN_ANIMATIONS.has(animation),
    papers: animation === "read",
    spin: animation === "celebrate",
  };
}

/** A transition into a raised hand: play the ding. */
export function raisesHand(
  prev: Pick<HenchmanState, "handRaised"> | undefined,
  next: Pick<HenchmanState, "handRaised">,
): boolean {
  return prev !== undefined && !prev.handRaised && next.handRaised;
}
