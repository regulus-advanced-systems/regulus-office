/**
 * The look and rules of the label over an agent (SPEC §9.3, D29; #256): a
 * subtle name tag and one bubble that says what the agent is doing, that it
 * needs you, or that it has an answer ready. Pure: no three.js, no DOM, so
 * the rules are tested without a scene. Drawn by AgentOverhead.tsx for
 * henchmen today and for office agents (the PM, assistants) when they arrive.
 */
import {
  type AgentBubble,
  type AgentBubbleKind,
  agentBubbleAsks,
  agentBubbleShown,
} from "@regulus/protocol";
import { lairAccents } from "../../ui/theme/lairPalette.ts";
import { colors } from "../../ui/theme.ts";

export type ShownBubbleKind = Exclude<AgentBubbleKind, "none">;

export interface BubbleLook {
  fill: string;
  ink: string;
  border: string;
  /** Glyph drawn in a badge before the text; "" for none. */
  badge: "" | "!" | "check";
  /** Sprite height on screen at the room framing and beyond, CSS pixels. */
  screenPx: number;
  /** Sprite height in the world, metres: what it measures once the camera is close. */
  worldHeight: number;
  opacity: number;
}

/** Quiet for activity, loud for the two that want the viewer. */
export const BUBBLE_LOOKS: Readonly<Record<ShownBubbleKind, BubbleLook>> = {
  doing: {
    fill: "#20282E",
    ink: colors.cream,
    border: "#3C4A53",
    badge: "",
    screenPx: 22,
    worldHeight: 0.26,
    opacity: 0.82,
  },
  needs_you: {
    fill: lairAccents.henchYellow,
    ink: "#1B1B1B",
    border: "#1B1B1B",
    badge: "!",
    screenPx: 28,
    worldHeight: 0.33,
    opacity: 1,
  },
  answer_ready: {
    fill: lairAccents.consoleTeal,
    ink: "#0E2422",
    border: "#0E2422",
    badge: "check",
    screenPx: 26,
    worldHeight: 0.31,
    opacity: 1,
  },
};

/** The name tag: text only, no plate, so it never competes with the status light. */
export const NAME_TAG = {
  ink: colors.cream,
  outline: "rgba(16, 20, 24, 0.85)",
  screenPx: 17,
  worldHeight: 0.19,
  opacity: 0.72,
} as const;

export const BUBBLE_MAX_CHARS = 34;
export const NAME_MAX_CHARS = 18;

const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const bubbleLabel = (text: string) => clip(text, BUBBLE_MAX_CHARS);
export const nameLabel = (name: string) => clip(name, NAME_MAX_CHARS);

export interface BubbleSettings {
  /** The viewer's "activity bubbles" setting; "needs you" and "answer ready" always show. */
  activityBubbles: boolean;
}

/** The bubble to draw for this viewer, or null. */
export function visibleBubble(
  bubble: AgentBubble | undefined,
  settings: BubbleSettings,
): AgentBubble | null {
  if (!agentBubbleShown(bubble)) return null;
  if (!settings.activityBubbles && !agentBubbleAsks(bubble)) return null;
  return bubble;
}

/** A click opens something only on a bubble that asks and names a target. */
export function bubbleClickable(bubble: AgentBubble | null | undefined): boolean {
  return !!bubble && agentBubbleAsks(bubble) && bubble.targetKind !== "none";
}

/** Camera distances (metres) over which labels fade out towards the overview. */
export const TAG_FADE = { from: 36, to: 52 } as const;
export const ACTIVITY_FADE = { from: 40, to: 56 } as const;
export const ASK_FADE = { from: 70, to: 110 } as const;

/** 1 up to `from`, 0 from `to` on, linear between. */
export function distanceFade(distance: number, range: { from: number; to: number }): number {
  if (!(distance > range.from)) return 1;
  if (distance >= range.to) return 0;
  return 1 - (distance - range.from) / (range.to - range.from);
}

/** Screen pixels one metre covers at `distance` from the camera, across the view. */
export function pixelsPerMetre(view: {
  distance: number;
  fovDeg: number;
  viewportPx: number;
}): number {
  const visible = 2 * Math.max(0.1, view.distance) * Math.tan((view.fovDeg * Math.PI) / 360);
  return Math.max(1, view.viewportPx) / visible;
}

/**
 * World height of a label: its own size in the world while the camera is close
 * (it grows and shrinks with the scene), and never less than `screenPx` on screen,
 * so it stays readable at the room framing and further out.
 */
export function labelWorldHeight(
  label: { screenPx: number; worldHeight: number },
  view: { distance: number; fovDeg: number; viewportPx: number },
  max = 1.6,
): number {
  const forScreen = label.screenPx / pixelsPerMetre(view);
  return Math.min(max, Math.max(label.worldHeight, forScreen));
}

/** "needs you" bobs gently; nothing moves with reduced motion or on the low preset. */
export function bubbleBobs(kind: ShownBubbleKind, opts: { still: boolean }): boolean {
  return kind === "needs_you" && !opts.still;
}

/** Vertical offset of the bob at time `t` seconds, as a fraction of the bubble's height. */
export function bobOffset(t: number): number {
  return Math.sin(t * 3.2) * 0.07;
}
