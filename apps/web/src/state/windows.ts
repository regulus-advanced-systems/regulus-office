/**
 * "Is a window open?" in one place (#282). A window is anything that takes
 * the mouse and the keyboard away from the scene: every `Modal` (it counts
 * itself here while open) and every HUD overlay (`ui.overlay`: the boards,
 * the terminal, settings, the spawn dialog, the whiteboard...). The
 * first-person rig reads this to free the pointer and stand still while one
 * is open (scene/fpv/windowPause.ts); nothing registers per window.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { useUiStore } from "./ui.ts";

interface WindowStore {
  /** Modals open right now (one opened from another counts twice). */
  modals: number;
}

export const useWindowStore = create<WindowStore>()(() => ({ modals: 0 }));

/** Count a modal as an open window while `open`; called by the shared `Modal`. */
export function useModalWindow(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    useWindowStore.setState((s) => ({ modals: s.modals + 1 }));
    return () => useWindowStore.setState((s) => ({ modals: Math.max(0, s.modals - 1) }));
  }, [open]);
}

export function isWindowOpen(overlay: string | null, modals: number): boolean {
  return overlay !== null || modals > 0;
}

/** Read once (event handlers, frame loops). */
export function anyWindowOpen(): boolean {
  return isWindowOpen(useUiStore.getState().overlay, useWindowStore.getState().modals);
}

/** Subscribe (components). */
export function useAnyWindowOpen(): boolean {
  const overlay = useUiStore((s) => s.overlay);
  const modals = useWindowStore((s) => s.modals);
  return isWindowOpen(overlay, modals);
}
