/**
 * Which desk the spawn dialog is open for (SPEC §9.2 `E` at a free desk,
 * §9.4 a carried issue card dropped on a desk prefills it, M2). The dialog
 * itself lives in ui/spawn; the scene only calls `openSpawn`.
 */
import { create } from "zustand";

/** Fields a caller may prefill (card drop, queue, tests). */
export interface SpawnPrefill {
  repoId?: string;
  issueNumber?: number;
  taskTitle?: string;
  prompt?: string;
}

export interface SpawnRequest {
  /** Seat the henchman should take; the server checks it is free. */
  seatId: string;
  prefill?: SpawnPrefill;
}

export interface SpawnStore {
  request: SpawnRequest | null;
  openSpawn: (seatId: string, prefill?: SpawnPrefill) => void;
  closeSpawn: () => void;
}

export const useSpawnStore = create<SpawnStore>()((set) => ({
  request: null,
  openSpawn: (seatId, prefill) => set({ request: prefill ? { seatId, prefill } : { seatId } }),
  closeSpawn: () => set({ request: null }),
}));
