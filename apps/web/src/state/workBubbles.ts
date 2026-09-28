/**
 * Work bubbles in flight per kind (SPEC §9.3 "bubbles fly to the floor's HUD
 * counters"). The HUD counter shows the floor total minus what is still in
 * the air, so a counter ticks up as each bubble lands and always ends on the
 * server's number. With reduced motion nothing is ever in flight.
 */
import { create } from "zustand";
import {
  type BubbleDelta,
  type BubbleKind,
  zeroDelta,
} from "../scene/robots/bubbles/bubbleEmits.ts";

export interface WorkBubblesStore {
  inFlight: BubbleDelta;
  launch: (kind: BubbleKind, n?: number) => void;
  land: (kind: BubbleKind, n?: number) => void;
  reset: () => void;
}

export const useWorkBubbles = create<WorkBubblesStore>()((set) => ({
  inFlight: zeroDelta(),
  launch: (kind, n = 1) =>
    set((s) => ({ inFlight: { ...s.inFlight, [kind]: s.inFlight[kind] + n } })),
  land: (kind, n = 1) =>
    set((s) => ({ inFlight: { ...s.inFlight, [kind]: Math.max(0, s.inFlight[kind] - n) } })),
  reset: () => set({ inFlight: zeroDelta() }),
}));
