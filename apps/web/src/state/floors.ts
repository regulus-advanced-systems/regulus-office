/**
 * Floors the signed-in user can see (REST `GET /api/floors`), with their
 * repos' clone status. The BuildingRoom floor list is the live, office-wide
 * directory; this list adds per-user access, template and repo details.
 */
import type { FloorInfo } from "@regulus/protocol";
import { create } from "zustand";
import { createFloorsApi, type FloorsApi } from "../ui/floors/api.ts";

export interface FloorsStore {
  /** Null until the first successful load. */
  floors: FloorInfo[] | null;
  error: string | null;
  refresh: (api?: FloorsApi) => Promise<void>;
  /** Insert or replace one floor (after create) without a round trip. */
  upsert: (floor: FloorInfo) => void;
  clear: () => void;
}

const defaultApi = createFloorsApi();

export const useFloorsStore = create<FloorsStore>()((set, get) => ({
  floors: null,
  error: null,
  refresh: async (api = defaultApi) => {
    const result = await api.list();
    if (result.ok) set({ floors: result.data.floors, error: null });
    else set({ error: result.code });
  },
  upsert: (floor) => {
    const rest = (get().floors ?? []).filter((f) => f.floorId !== floor.floorId);
    set({ floors: [...rest, floor].sort((a, b) => a.index - b.index) });
  },
  clear: () => set({ floors: null, error: null }),
}));

/** True while any repo of any listed floor is still cloning. */
export function anyCloning(floors: readonly FloorInfo[] | null): boolean {
  return (floors ?? []).some((f) => f.repos.some((r) => r.cloneStatus === "cloning"));
}

/** Summary chip for the elevator: `cloning` / `error` / null when all repos are ready. */
export function cloneBadge(floor: FloorInfo | undefined): "cloning" | "error" | null {
  if (!floor) return null;
  if (floor.repos.some((r) => r.cloneStatus === "error")) return "error";
  if (floor.repos.some((r) => r.cloneStatus === "cloning")) return "cloning";
  return null;
}
