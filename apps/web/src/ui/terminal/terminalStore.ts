/**
 * Which henchman's terminal modal is open. The scene (laptop click, `E` at an
 * occupied desk) and later the henchmen themselves (#29) call `openTerminal`.
 */
import { create } from "zustand";

export interface TerminalModalStore {
  agentId: string | null;
  openTerminal: (agentId: string) => void;
  closeTerminal: () => void;
}

export const useTerminalModal = create<TerminalModalStore>()((set) => ({
  agentId: null,
  openTerminal: (agentId) => set({ agentId }),
  closeTerminal: () => set({ agentId: null }),
}));
