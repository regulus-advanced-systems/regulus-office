/**
 * The last ring of the merge gong heard on the floor we are on (#43). The
 * gong, the henchmen and the confetti all read it; gongSync.ts writes it from
 * the OperationRoom's `pr.merged` / `gong.ring` messages. Changing operations forgets it.
 */
import type { GongCause } from "@regulus/protocol";
import { create } from "zustand";
import type { GongRingView } from "./timing.ts";

export interface GongStore {
  ring: GongRingView | null;
  /** Strikes heard on this page so far (read by the e2e probes). */
  strikes: number;
  heard(
    input: { operationId: string; cause: GongCause; strikes: number },
    now?: number,
  ): GongRingView;
  forget(): void;
}

let nextId = 1;

export const useGongStore = create<GongStore>()((set) => ({
  ring: null,
  strikes: 0,
  heard(input, now = performance.now()) {
    const ring: GongRingView = { id: nextId++, ...input, at: now };
    set((s) => ({ ring, strikes: s.strikes + input.strikes }));
    return ring;
  },
  forget: () => set({ ring: null }),
}));
