/**
 * Which provider the credential profiles panel should open on. #32 builds
 * the panel and mounts it on this store; until then `openProvidersPanel`
 * only records the request. The spawn dialog's "Connect <provider>" link
 * calls it when the human has no saved profile for the chosen provider.
 */
import type { ProviderId } from "@regulus/protocol";
import { create } from "zustand";

export interface ProvidersPanelStore {
  /** Provider the panel is open on; null when closed. */
  provider: ProviderId | null;
  openProvidersPanel: (provider: ProviderId) => void;
  closeProvidersPanel: () => void;
}

export const useProvidersPanel = create<ProvidersPanelStore>()((set) => ({
  provider: null,
  openProvidersPanel: (provider) => set({ provider }),
  closeProvidersPanel: () => set({ provider: null }),
}));
