/** OperationRoom state mirror (SPEC §6 channel 2) for the one operation we are on. */
import type { HenchmanState, OperationState } from "@regulus/protocol";
import { create } from "zustand";

export interface OperationStore {
  /** Operation we are joined to (or joining); null in the building only. */
  operationId: string | null;
  state: OperationState | null;
  apply: (snapshot: OperationState) => void;
  setOperationId: (operationId: string | null) => void;
  clear: () => void;
}

export const useOperationStore = create<OperationStore>()((set) => ({
  operationId: null,
  state: null,
  apply: (snapshot) => set({ state: snapshot, operationId: snapshot.operationId }),
  setOperationId: (operationId) => set({ operationId }),
  clear: () => set({ operationId: null, state: null }),
}));

export function selectHenchmen(store: OperationStore): HenchmanState[] {
  return store.state ? Object.values(store.state.henchmen) : [];
}
