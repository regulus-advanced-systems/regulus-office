/** FloorRoom state mirror (SPEC §6 channel 2) for the one floor we are on. */
import type { FloorState, RobotState } from "@regulus/protocol";
import { create } from "zustand";

export interface FloorStore {
  /** Floor we are joined to (or joining); null in the building only. */
  floorId: string | null;
  state: FloorState | null;
  apply: (snapshot: FloorState) => void;
  setFloorId: (floorId: string | null) => void;
  clear: () => void;
}

export const useFloorStore = create<FloorStore>()((set) => ({
  floorId: null,
  state: null,
  apply: (snapshot) => set({ state: snapshot, floorId: snapshot.floorId }),
  setFloorId: (floorId) => set({ floorId }),
  clear: () => set({ floorId: null, state: null }),
}));

export function selectRobots(store: FloorStore): RobotState[] {
  return store.state ? Object.values(store.state.robots) : [];
}
