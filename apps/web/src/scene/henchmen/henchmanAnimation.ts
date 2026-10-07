/**
 * What a henchman at its desk does (SPEC §9.3): `HenchmanState.status` + `.action`
 * → avatar animation, whether it stays seated, the gesture on top (#235) and
 * the extras around it (papers while reading). Pure; the HenchmanLayer applies it.
 *
 * - working: typing / editing / running tests → sit_type; reading / browsing
 *   → read (seated, with papers); thinking → think (seated, head tilt);
 * - failing (action) or error (status) → facepalm, a one-shot: after
 *   `ONE_SHOT_MS` the henchman sits back down (animationSettle.ts);
 * - everything else (starting, idle, waiting, done, exited, offline) → sit_idle,
 *   which is a still seated pose (#159), with a gesture on top (`gestureFor`):
 *   - done, with an answer its owner has not looked at yet → one hand up, held
 *     still. No spin, no confetti (#235). It goes down with the "answer ready"
 *     bubble (#256), which the server clears when the owner deals with it;
 *   - waiting for a permission or an answer → both arms up, waving ("needs you").
 * - `celebrate` (stands up, spins, confetti) is left for an explicit
 *   `celebrating` action; finishing no longer plays it. The merge gong's cheer
 *   is its own thing (cheer.ts).
 *
 * With reduced motion every henchman is still in its chair (`calmFor`) and the
 * "needs you" arms are held up without waving; the light still tells the status.
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
  // Done sits still with a hand up (`gestureFor`); it does not celebrate (#235).
  "done",
  "exited",
  "offline",
]);

export function henchmanAnimationFor(
  henchman: Pick<HenchmanState, "status" | "action">,
): AvatarAnimation {
  const { status, action } = henchman;
  if (status === "error") return "facepalm";
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
 * What the arms say on top of the seated clip (#235):
 * - `hand`: one hand up, held still: it is done and has something to look at;
 * - `needs_you`: both arms up and waving: it waits for its human;
 * - `needs_you_still`: the same arms held up without motion.
 */
export const HENCHMAN_GESTURES = ["none", "hand", "needs_you", "needs_you_still"] as const;
export type HenchmanGesture = (typeof HENCHMAN_GESTURES)[number];

const WAITING: ReadonlySet<AgentStatus> = new Set(["waiting_permission", "waiting_input"]);

/**
 * The gesture of a henchman. The two waiting kinds share it: the "needs you"
 * bubble above says which it is ("approve a command", "answer a question"), so
 * no second icon is drawn over the head. The done hand follows the "answer
 * ready" bubble, so both go when the owner has dealt with it. `still`: reduced
 * motion or the low graphics preset.
 */
export function gestureFor(
  henchman: Pick<HenchmanState, "status"> & { bubble?: Pick<HenchmanState["bubble"], "kind"> },
  still = false,
): HenchmanGesture {
  if (WAITING.has(henchman.status)) return still ? "needs_you_still" : "needs_you";
  if (henchman.status === "done" || henchman.status === "idle") {
    return henchman.bubble?.kind === "answer_ready" ? "hand" : "none";
  }
  return "none";
}

/** The gesture when only the status is known (showcases): a done henchman has not been looked at. */
export function gestureForStatus(status: AgentStatus | undefined, still = false): HenchmanGesture {
  if (!status) return "none";
  return gestureFor(
    { status, bubble: { kind: status === "done" ? "answer_ready" : "none" } },
    still,
  );
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

/** A henchman starts waiting for its human (`handRaised` in the protocol): play the ding. */
export function raisesHand(
  prev: Pick<HenchmanState, "handRaised"> | undefined,
  next: Pick<HenchmanState, "handRaised">,
): boolean {
  return prev !== undefined && !prev.handRaised && next.handRaised;
}
