/**
 * Screen positions of the HUD work counters, so bubbles in the scene know
 * where to fly. The counters register their element; the scene reads the
 * centre in client pixels when a bubble takes off.
 */
import type { BubbleKind } from "../../scene/robots/bubbles/bubbleEmits.ts";

const anchors = new Map<BubbleKind, HTMLElement>();

export function registerCounterAnchor(kind: BubbleKind, element: HTMLElement | null): void {
  if (element) anchors.set(kind, element);
  else anchors.delete(kind);
}

export function counterAnchorPoint(kind: BubbleKind): { x: number; y: number } | null {
  const el = anchors.get(kind);
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
