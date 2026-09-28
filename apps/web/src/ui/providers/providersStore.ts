/**
 * Opening the "Connect providers" panel. Settings opens it; the spawn dialog
 * (#29) calls `openProvidersPanel(provider)` when the chosen provider is not
 * connected, which scrolls that provider into view.
 */
import type { ProviderId } from "@regulus/protocol";
import { create } from "zustand";
import { useUiStore } from "../../state/ui.ts";

export const PROVIDERS_OVERLAY = "providers";

export interface ProvidersPanelStore {
  /** Provider to highlight when the panel opens (e.g. from the spawn dialog). */
  focus: ProviderId | null;
  setFocus: (focus: ProviderId | null) => void;
}

export const useProvidersPanel = create<ProvidersPanelStore>()((set) => ({
  focus: null,
  setFocus: (focus) => set({ focus }),
}));

export function openProvidersPanel(focus: ProviderId | null = null): void {
  useProvidersPanel.getState().setFocus(focus);
  useUiStore.getState().openOverlay(PROVIDERS_OVERLAY);
}

export function closeProvidersPanel(): void {
  useProvidersPanel.getState().setFocus(null);
  useUiStore.getState().closeOverlay(PROVIDERS_OVERLAY);
}
