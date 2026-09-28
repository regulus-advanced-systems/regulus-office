/**
 * Claim the HUD keyboard (`ui.overlay`) while an agent dialog is open, so
 * WASD and hotkeys stay quiet while the human types or picks an option.
 */
import { useEffect } from "react";
import { useUiStore } from "../../state/ui.ts";

export function useAgentOverlay(open: boolean, id: string): void {
  useEffect(() => {
    if (!open) return;
    const ui = useUiStore.getState();
    if (ui.overlay === null) ui.openOverlay(id);
    return () => useUiStore.getState().closeOverlay(id);
  }, [open, id]);
}
