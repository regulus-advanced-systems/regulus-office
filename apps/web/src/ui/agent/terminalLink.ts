/**
 * Seam to the terminal modal (#25): the panel's "Terminal" button calls the
 * registered opener. Until #25's `useTerminalModal().openTerminal` is wired
 * here, no opener is registered and the button is hidden.
 */
import { create } from "zustand";

interface TerminalLinkStore {
  open: ((agentId: string) => void) | null;
}

export const useTerminalLink = create<TerminalLinkStore>()(() => ({ open: null }));

export function registerTerminalOpener(open: ((agentId: string) => void) | null): void {
  useTerminalLink.setState({ open });
}
