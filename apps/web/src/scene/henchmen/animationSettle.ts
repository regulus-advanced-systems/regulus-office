/**
 * Which animation a henchman at its desk shows, over time (#159). The server's
 * status/action can change several times a second (starting → idle →
 * working/thinking → working/editing within a few seconds of a spawn, or a
 * failed tool call flipping the action for a moment); following each change
 * restarts a crossfade and reads as twitching. So:
 *
 * - The first animation shows at once (a one-shot on first sight does not
 *   replay: a henchman that finished an hour ago does not dance on page load).
 * - Later, a new animation shows only once it has been wanted for
 *   `SETTLE_MS`: shorter changes never reach the avatar, and the henchman
 *   crossfades once per real change.
 * - One-shots (facepalm, celebrate) play to their end (`ONE_SHOT_MS`), then
 *   the henchman is still in its chair until the wanted animation changes.
 *
 * Pure: `settleStep` is fed the wanted animation and a clock.
 */
import type { AvatarAnimation } from "@regulus/protocol";
import { ONE_SHOT_MS, STILL } from "./henchmanAnimation.ts";

/** A wanted animation must hold this long before the henchman shows it, ms. */
export const SETTLE_MS = 1500;

export interface SettleState {
  /** What the avatar plays. */
  shown: AvatarAnimation;
  /** When `shown` started, ms. */
  shownAt: number;
  /** The latest wanted animation. */
  wanted: AvatarAnimation;
  /** Since when `wanted` has been wanted, ms. */
  wantedSince: number;
  /** A one-shot that has played for the current `wanted`: do not play it again. */
  spent: AvatarAnimation | null;
}

const isOneShot = (a: AvatarAnimation) => ONE_SHOT_MS[a] !== undefined;

export function settleStart(wanted: AvatarAnimation, now: number): SettleState {
  const oneShot = isOneShot(wanted);
  return {
    shown: oneShot ? STILL : wanted,
    shownAt: now,
    wanted,
    wantedSince: now,
    spent: oneShot ? wanted : null,
  };
}

/** The state at `now`, given the animation the henchman's status/action asks for. */
export function settleStep(state: SettleState, wanted: AvatarAnimation, now: number): SettleState {
  let { shown, shownAt, wantedSince, spent } = state;
  if (wanted !== state.wanted) wantedSince = now;
  if (spent !== null && wanted !== spent) spent = null;

  const limit = ONE_SHOT_MS[shown];
  if (limit !== undefined) {
    // A one-shot runs to its end whatever is wanted meanwhile.
    if (now - shownAt < limit) return { shown, shownAt, wanted, wantedSince, spent };
    if (wanted === shown) spent = shown;
    shown = STILL;
    shownAt = now;
  }

  const target = wanted === spent ? STILL : wanted;
  if (target !== shown && now - wantedSince >= SETTLE_MS) {
    shown = target;
    shownAt = now;
  }
  return { shown, shownAt, wanted, wantedSince, spent };
}

/** Milliseconds from `now` until `settleStep` could change `shown`, or null if it cannot. */
export function settleDeadline(state: SettleState, now: number): number | null {
  const limit = ONE_SHOT_MS[state.shown];
  if (limit !== undefined) return Math.max(0, state.shownAt + limit - now);
  const target = state.wanted === state.spent ? STILL : state.wanted;
  if (target === state.shown) return null;
  return Math.max(0, state.wantedSince + SETTLE_MS - now);
}
