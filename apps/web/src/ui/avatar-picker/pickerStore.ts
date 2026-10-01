/**
 * Who opened the genius picker: the office on first login, or Settings (the
 * picker returns there when it closes). The picker is a HUD overlay, so the
 * hotkeys, WASD and cursor turning stay muted while it is open.
 */
import { create } from "zustand";
import { useUiStore } from "../../state/ui.ts";

export const GENIUS_OVERLAY = "genius";

export type PickerReason = "first_login" | "settings";

interface PickerStore {
  reason: PickerReason;
  /** The first-login prompt ran in this page load (it shows once per visit). */
  prompted: boolean;
}

export const usePickerStore = create<PickerStore>()(() => ({
  reason: "settings",
  prompted: false,
}));

export function openGeniusPicker(reason: PickerReason): void {
  usePickerStore.setState(reason === "first_login" ? { reason, prompted: true } : { reason });
  useUiStore.getState().openOverlay(GENIUS_OVERLAY);
}

export function closeGeniusPicker(): void {
  const { reason } = usePickerStore.getState();
  const ui = useUiStore.getState();
  if (reason === "settings") ui.openOverlay("settings");
  else ui.closeOverlay(GENIUS_OVERLAY);
}
