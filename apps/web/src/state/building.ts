/** BuildingRoom state mirror (SPEC §6 channel 1), patched by the net layer. */
import type { BuildingState, FloorSummary, HumanPresence } from "@regulus/protocol";
import { create } from "zustand";

export interface BuildingStore {
  /** Full snapshot of the BuildingRoom state; null until the first patch. */
  state: BuildingState | null;
  /** Our Colyseus session id in the BuildingRoom; null while not joined. */
  sessionId: string | null;
  apply: (snapshot: BuildingState) => void;
  setSessionId: (sessionId: string | null) => void;
  clear: () => void;
}

export const useBuildingStore = create<BuildingStore>()((set) => ({
  state: null,
  sessionId: null,
  apply: (snapshot) => set({ state: snapshot }),
  setSessionId: (sessionId) => set({ sessionId }),
  clear: () => set({ state: null, sessionId: null }),
}));

/** Floors in elevator order. */
export function selectFloors(store: BuildingStore): FloorSummary[] {
  const floors = store.state ? Object.values(store.state.floors) : [];
  return floors.sort((a, b) => a.index - b.index);
}

/** The local human's presence, if the server has published it. */
export function selectSelf(store: BuildingStore): HumanPresence | null {
  if (!store.state || !store.sessionId) return null;
  return store.state.humans[store.sessionId] ?? null;
}
