/** Which robot's changes window is open (#38). The robot panel opens it. */
import { create } from "zustand";

export interface ChangesWindowStore {
  agentId: string | null;
  openChanges: (agentId: string) => void;
  closeChanges: () => void;
}

export const useChangesWindow = create<ChangesWindowStore>()((set) => ({
  agentId: null,
  openChanges: (agentId) => set({ agentId }),
  closeChanges: () => set({ agentId: null }),
}));
