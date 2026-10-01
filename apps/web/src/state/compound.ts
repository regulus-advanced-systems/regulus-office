/**
 * The compound as this viewer sees it (#186, scene/compound/world.ts), kept
 * current from the BuildingRoom state and the REST floor list. The object
 * only changes when something drawn changes (layout, access, build state,
 * settings, counters), never on a presence patch, so the scene can memoise
 * on it. Quick travel, search jumps and notifications read it too.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { type CompoundWorld, compoundWorld } from "../scene/compound/world.ts";
import { useBuildingStore } from "./building.ts";
import { useFloorsStore } from "./floors.ts";

export interface CompoundStore {
  world: CompoundWorld | null;
  set: (world: CompoundWorld | null) => void;
}

export const useCompoundStore = create<CompoundStore>()((set) => ({
  world: null,
  set: (world) => set({ world }),
}));

/** A string that changes exactly when the drawn world does. */
export function worldKey(world: CompoundWorld | null): string {
  if (!world) return "";
  return [
    world.version,
    world.width,
    world.depth,
    ...world.rooms.map((r) =>
      [
        r.id,
        r.name,
        r.enterable ? 1 : 0,
        r.buildState,
        r.buildEndsAt,
        r.deskCount,
        r.decorStyle,
        r.robotsWorking,
        r.robotsWaiting,
        r.robotsTotal,
        r.rect.x,
        r.rect.y,
        r.rect.w,
        r.rect.d,
        r.doorSide,
      ].join(":"),
    ),
  ].join("|");
}

/** Recompute the world from the stores and publish it when it changed. */
export function syncCompoundWorld(): void {
  const building = useBuildingStore.getState().state;
  const floors = useFloorsStore.getState().floors;
  const enterable = floors ? new Set(floors.map((f) => f.floorId)) : null;
  const next = compoundWorld(building, enterable);
  const store = useCompoundStore.getState();
  if (worldKey(next) !== worldKey(store.world)) store.set(next);
}

/** Keep `useCompoundStore` in step while mounted (the office page mounts it once). */
export function useCompoundWorldSync(): void {
  useEffect(() => {
    syncCompoundWorld();
    const offBuilding = useBuildingStore.subscribe((s, prev) => {
      if (s.state?.compound !== prev.state?.compound || s.state?.floors !== prev.state?.floors)
        syncCompoundWorld();
    });
    const offFloors = useFloorsStore.subscribe(syncCompoundWorld);
    return () => {
      offBuilding();
      offFloors();
      useCompoundStore.getState().set(null);
    };
  }, []);
}
