/**
 * Which labels over agents a viewer sees (#283): a full room read as a wall of
 * overlapping bubbles, so the small "doing" bubbles show only for agents near
 * the viewer's character or under the cursor, name tags the same at a longer
 * radius (and always for the viewer's own agents), and the two bubbles that
 * want the viewer ("needs you", "answer ready") at any distance. Pure: no
 * three.js, no React; AgentOverhead.tsx applies it every frame.
 */
import type { AgentBubbleKind } from "@regulus/protocol";

/**
 * Metres from the viewer's character within which an agent's "doing" bubble
 * shows: the desk block you stand at and the near side of its neighbours. The one number
 * to tune how busy a walk through a full room reads.
 */
export const ACTIVITY_RADIUS = 4;
/** The same for name tags: further, so you can tell who sits around you. */
export const NAME_TAG_RADIUS = 8;
/** Metres past a radius over which a label fades out as you walk away. */
export const RADIUS_FADE = 1.5;
/** Seconds a label takes to fade in or out (hover, a radius crossed in one step). */
export const FADE_SECONDS = 0.2;

export interface OverheadSight {
  /** Metres between the viewer's character and the agent; Infinity when the viewer is not around. */
  distance: number;
  /** The agent is under the cursor, or is the one the viewer has open. */
  hovered: boolean;
  /** The agent belongs to the viewer. */
  own: boolean;
  /** The bubble the agent shows; null or "none" for no bubble. */
  kind: AgentBubbleKind | null;
  /** The viewer's "Activity bubbles" setting. */
  activityBubbles: boolean;
  /** No fades: a label is shown or hidden. */
  reducedMotion: boolean;
}

/** 1 within `radius`, fading to 0 over `RADIUS_FADE`; with reduced motion 1 or 0. */
export function nearness(distance: number, radius: number, reducedMotion: boolean): number {
  if (!(distance > radius)) return Number.isNaN(distance) ? 0 : 1;
  if (reducedMotion || distance >= radius + RADIUS_FADE) return 0;
  return 1 - (distance - radius) / RADIUS_FADE;
}

/** How much of the name tag and of the bubble this viewer should see, each 0..1. */
export function overheadVisibility(sight: OverheadSight): { tag: number; bubble: number } {
  const { distance, hovered, reducedMotion } = sight;
  const tag = sight.own || hovered ? 1 : nearness(distance, NAME_TAG_RADIUS, reducedMotion);
  let bubble = 0;
  if (sight.kind === "needs_you" || sight.kind === "answer_ready") bubble = 1;
  else if (sight.kind === "doing" && sight.activityBubbles)
    bubble = hovered ? 1 : nearness(distance, ACTIVITY_RADIUS, reducedMotion);
  return { tag, bubble };
}

/** One frame of a fade from `current` towards `target`; with reduced motion it is there at once. */
export function fadeToward(
  current: number,
  target: number,
  dt: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return target;
  if (!(dt > 0)) return current;
  const step = dt / FADE_SECONDS;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}
