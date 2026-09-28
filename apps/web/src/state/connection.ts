/** Connection status exposed by the net layer for the HUD. */
import { create } from "zustand";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "disconnected";

export interface ConnectionStore {
  status: ConnectionStatus;
  /** Re-join attempts made since the last successful join. */
  attempt: number;
  lastError: string | null;
  set: (patch: Partial<Omit<ConnectionStore, "set">>) => void;
}

export const useConnectionStore = create<ConnectionStore>()((set) => ({
  status: "idle",
  attempt: 0,
  lastError: null,
  set: (patch) => set(patch),
}));
