/**
 * What the labels over one group of agents share (#283): where the viewer's
 * character stands, which agent is under the cursor, the viewer's settings,
 * and the screen boxes of the always-on bubbles, so they can be kept apart.
 * A plain mutable object written by the layer that owns the agents and read
 * by every AgentOverhead in its render loop: no React state, nothing re-renders
 * when the player walks or the cursor moves.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { type StackRect, stackOffsets } from "./overheadStack.ts";

/** One always-on bubble's box on screen; `offset` is how far up it should move, pixels. */
export interface StackSlot extends StackRect {
  /** Drawn this frame (not faded out by the zoom). */
  active: boolean;
  offset: number;
}

export interface OverheadField {
  /** The viewer's character, in the frame the overheads' `position` is given in; null when not around. */
  viewer: { x: number; z: number } | null;
  /** The agent under the cursor, and the one the viewer has open. */
  hoveredId: string | null;
  focusedId: string | null;
  activityBubbles: boolean;
  /** No fades and no eased stacking: labels are shown or hidden, and sit where they belong. */
  reducedMotion: boolean;
  slots: Map<string, StackSlot>;
}

export function createOverheadField(): OverheadField {
  return {
    viewer: null,
    hoveredId: null,
    focusedId: null,
    activityBubbles: true,
    reducedMotion: false,
    slots: new Map(),
  };
}

const active: StackSlot[] = [];

/** Recompute every active slot's offset; inactive slots go back to 0. */
export function solveStack(field: OverheadField): void {
  active.length = 0;
  for (const slot of field.slots.values()) {
    if (slot.active) active.push(slot);
    else slot.offset = 0;
  }
  if (active.length === 0) return;
  if (active.length === 1) {
    (active[0] as StackSlot).offset = 0;
    return;
  }
  const offsets = stackOffsets(active);
  for (const slot of active) slot.offset = offsets.get(slot.id) ?? 0;
}

/** A field for one layer of agents; its always-on bubbles are stacked once a frame. */
export function useOverheadField(): OverheadField {
  const field = useMemo(createOverheadField, []);
  useFrame(() => solveStack(field));
  return field;
}
