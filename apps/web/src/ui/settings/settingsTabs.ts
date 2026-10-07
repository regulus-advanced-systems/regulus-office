/**
 * The Settings dialog's tabs (#225): which exist, who sees them, and the one
 * that is open. The last-open tab is remembered for the browser session
 * (sessionStorage, every access wrapped: private modes and blocked storage
 * just forget it). Owners and admins see Office and Henchmen; everyone else
 * never lands on them, even if a remembered id says so. Agents (#271) is for
 * everyone: each person has their own, and the shared ones serve all.
 */
import type { UserRole } from "@regulus/protocol";
import { create } from "zustand";
import { canManageOffice } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import type { StorageLike } from "./settingsStorage.ts";

export const SETTINGS_TAB_IDS = [
  "you",
  "office",
  "henchmen",
  "agents",
  "notifications",
  "display",
] as const;
export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export const SETTINGS_TAB_LABELS: Readonly<Record<SettingsTabId, string>> = {
  you: "You",
  office: "Office",
  henchmen: "Henchmen",
  agents: "Agents",
  notifications: "Notifications",
  display: "Display and sound",
};

const MANAGERS_ONLY: ReadonlySet<SettingsTabId> = new Set(["office", "henchmen"]);

export const SETTINGS_TAB_STORAGE_KEY = "regulus.settings.tab";

/** The tabs a role may open, in rail order. */
export function visibleSettingsTabs(role: UserRole | undefined): SettingsTabId[] {
  const manager = canManageOffice(role);
  return SETTINGS_TAB_IDS.filter((id) => manager || !MANAGERS_ONLY.has(id));
}

/** The tab to show: the chosen one if this role may see it, else the first. */
export function effectiveSettingsTab(
  chosen: SettingsTabId,
  role: UserRole | undefined,
): SettingsTabId {
  const visible = visibleSettingsTabs(role);
  return visible.includes(chosen) ? chosen : (visible[0] ?? "you");
}

function isTabId(value: unknown): value is SettingsTabId {
  return (SETTINGS_TAB_IDS as readonly unknown[]).includes(value);
}

function sessionStore(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function loadSettingsTab(storage: StorageLike | null = sessionStore()): SettingsTabId {
  try {
    const raw = storage?.getItem(SETTINGS_TAB_STORAGE_KEY);
    return isTabId(raw) ? raw : "you";
  } catch {
    return "you";
  }
}

export function saveSettingsTab(
  tab: SettingsTabId,
  storage: StorageLike | null = sessionStore(),
): void {
  try {
    storage?.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
  } catch {
    // Blocked storage: the tab is not remembered.
  }
}

interface SettingsTabStore {
  tab: SettingsTabId;
  setTab: (tab: SettingsTabId) => void;
}

export const useSettingsTabStore = create<SettingsTabStore>()((set) => ({
  tab: loadSettingsTab(),
  setTab: (tab) => {
    saveSettingsTab(tab);
    set({ tab });
  },
}));

/** Open Settings on a given tab (the GitHub manifest return lands on Office). */
export function openSettingsAt(tab: SettingsTabId): void {
  useSettingsTabStore.getState().setTab(tab);
  useUiStore.getState().openOverlay("settings");
}
