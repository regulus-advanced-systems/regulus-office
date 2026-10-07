/**
 * The compound as this viewer sees it (#186, scene/compound/world.ts): the
 * one level they are looking at (#268, level.ts), kept
 * current from the BuildingRoom state and the REST operation list. The object
 * only changes when something drawn changes (layout, access, build state,
 * settings, counters), never on a presence patch, so the scene can memoise
 * on it. Quick travel, search jumps and notifications read it too.
 */

import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { useEffect } from "react";
import { create } from "zustand";
import { type CompoundWorld, compoundWorld } from "../scene/compound/world.ts";
import { useBuildingStore } from "./building.ts";
import { isKnownLevel, levelView, useLevelStore } from "./level.ts";
import { useOperationsStore } from "./operations.ts";

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
        r.henchmenWorking,
        r.henchmenWaiting,
        r.henchmenTotal,
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
  const operations = useOperationsStore.getState().operations;
  const enterable = operations ? new Set(operations.map((f) => f.operationId)) : null;
  // A level that is gone (its last room archived or deleted) leaves its viewers in the lobby.
  const level = useLevelStore.getState();
  if (building && !isKnownLevel(building, level.levelId)) level.set(LOBBY_LEVEL_ID);
  const next = compoundWorld(levelView(building, useLevelStore.getState().levelId), enterable);
  const store = useCompoundStore.getState();
  if (worldKey(next) !== worldKey(store.world)) store.set(next);
}

/** Keep `useCompoundStore` in step while mounted (the office page mounts it once). */
export function useCompoundWorldSync(): void {
  useEffect(() => {
    syncCompoundWorld();
    const offBuilding = useBuildingStore.subscribe((s, prev) => {
      if (
        s.state?.compound !== prev.state?.compound ||
        s.state?.levels !== prev.state?.levels ||
        s.state?.operations !== prev.state?.operations
      )
        syncCompoundWorld();
    });
    const offOperations = useOperationsStore.subscribe(syncCompoundWorld);
    const offLevel = useLevelStore.subscribe(syncCompoundWorld);
    return () => {
      offBuilding();
      offOperations();
      offLevel();
      useCompoundStore.getState().set(null);
    };
  }, []);
}
