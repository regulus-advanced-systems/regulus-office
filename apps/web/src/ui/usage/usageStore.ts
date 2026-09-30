/**
 * The viewer's own usage (#40): fetched from `/api/usage/me`, never from
 * shared room state. Refreshed every minute while the tab is visible, and
 * soon after the office totals in the BuildingRoom change (a cheap "new
 * usage happened" signal), at most every {@link MIN_REFRESH_MS}.
 */
import { MY_USAGE_API_PATH, MyUsage } from "@regulus/protocol";
import { useEffect } from "react";
import { create } from "zustand";
import { useBuildingStore } from "../../state/building.ts";

export const POLL_MS = 60_000;
export const MIN_REFRESH_MS = 10_000;

export interface MyUsageStore {
  mine: MyUsage | null;
  /** HUD usage panel open. */
  panelOpen: boolean;
  lastFetchAt: number;
  setMine(mine: MyUsage | null, at: number): void;
  togglePanel(open?: boolean): void;
}

export const useMyUsageStore = create<MyUsageStore>()((set) => ({
  mine: null,
  panelOpen: false,
  lastFetchAt: 0,
  setMine: (mine, at) => set({ mine, lastFetchAt: at }),
  togglePanel: (open) => set((s) => ({ panelOpen: open ?? !s.panelOpen })),
}));

/** GET the viewer's own usage; null when signed out, offline or malformed. */
export async function fetchMyUsage(
  doFetch: typeof fetch = fetch,
  tzOffset: number = new Date().getTimezoneOffset(),
): Promise<MyUsage | null> {
  try {
    const res = await doFetch(`${MY_USAGE_API_PATH}?tz=${Math.trunc(tzOffset)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const parsed = MyUsage.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Keeps `useMyUsageStore.mine` fresh; mount once (the HUD does). */
export function useMyUsagePolling(doFetch: typeof fetch = fetch): void {
  const officeObservedAt = useBuildingStore((s) => s.state?.usage.observedAt ?? 0);
  useEffect(() => {
    let cancelled = false;
    const refresh = async (force = false) => {
      const { lastFetchAt, setMine } = useMyUsageStore.getState();
      const now = Date.now();
      if (!force && now - lastFetchAt < MIN_REFRESH_MS) return;
      if (typeof document !== "undefined" && document.hidden) return;
      useMyUsageStore.setState({ lastFetchAt: now });
      const mine = await fetchMyUsage(doFetch);
      if (!cancelled) setMine(mine, now);
    };
    void refresh(officeObservedAt === 0);
    const timer = setInterval(() => void refresh(true), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [officeObservedAt, doFetch]);
}
