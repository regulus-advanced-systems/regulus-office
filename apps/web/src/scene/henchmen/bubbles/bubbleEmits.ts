/**
 * GDT-style work bubbles (SPEC §9.3, research 03 §4): which bubbles to emit
 * from a henchman's `bubbleEmits` counters. The server only ever counts up
 * (per task); a counter that went down was reset and emits nothing. A henchman
 * seen for the first time emits nothing either, so joining an operation does not
 * flood the scene with the whole history.
 */
import type { BubbleEmits } from "@regulus/protocol";
import { colors } from "../../../ui/theme.ts";

export const BUBBLE_KINDS = ["toolCalls", "fileEdits", "testRuns", "toolFailures"] as const;
export type BubbleKind = (typeof BUBBLE_KINDS)[number];

/** Cyan tool calls, amber edits, blue tests, orange-red failures (SPEC §9.3). */
export const BUBBLE_COLORS: Readonly<Record<BubbleKind, string>> = {
  toolCalls: colors.cyan,
  fileEdits: colors.amber,
  testRuns: colors.blue,
  toolFailures: colors.orangeRed,
};

export const BUBBLE_LABELS: Readonly<Record<BubbleKind, string>> = {
  toolCalls: "Tool calls",
  fileEdits: "Edits",
  testRuns: "Tests",
  toolFailures: "Failures",
};

/** Most bubbles one counter update turns into; the rest go straight to the HUD. */
export const MAX_BUBBLES_PER_UPDATE = 6;

export type BubbleDelta = Record<BubbleKind, number>;

export function zeroDelta(): BubbleDelta {
  return { toolCalls: 0, fileEdits: 0, testRuns: 0, toolFailures: 0 };
}

/** New events per kind between two counter snapshots (never negative). */
export function bubbleDelta(prev: BubbleEmits | undefined, next: BubbleEmits): BubbleDelta {
  const out = zeroDelta();
  if (!prev) return out;
  for (const kind of BUBBLE_KINDS) out[kind] = Math.max(0, next[kind] - prev[kind]);
  return out;
}

/**
 * Bubbles to launch for a delta, at most `cap`, taken round-robin across the
 * kinds so a burst of tool calls does not hide the one failure.
 */
export function bubblesFor(delta: BubbleDelta, cap = MAX_BUBBLES_PER_UPDATE): BubbleKind[] {
  const left = { ...delta };
  const out: BubbleKind[] = [];
  while (out.length < cap) {
    let added = false;
    for (const kind of BUBBLE_KINDS) {
      if (out.length >= cap) break;
      if (left[kind] > 0) {
        left[kind] -= 1;
        out.push(kind);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

export function sumBubbleEmits(henchmen: Iterable<{ bubbleEmits: BubbleEmits }>): BubbleDelta {
  const out = zeroDelta();
  for (const r of henchmen) for (const kind of BUBBLE_KINDS) out[kind] += r.bubbleEmits[kind];
  return out;
}
