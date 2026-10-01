/**
 * FloorRoom state of every joined room (SPEC §9.1 presence, #186): the room
 * the player is in and up to three nearby visible rooms, keyed by floor id.
 * The scene draws robots, boards and screens for each; the HUD keeps
 * reading `useFloorStore`, which mirrors only the room the player is in.
 */
import type { FloorState } from "@regulus/protocol";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { FloorStore } from "./floor.ts";

export interface RoomsStore {
  states: Readonly<Record<string, FloorState>>;
  apply: (floorId: string, state: FloorState) => void;
  drop: (floorId: string) => void;
  clear: () => void;
}

export const useRoomsStore = create<RoomsStore>()((set) => ({
  states: {},
  apply: (floorId, state) => set((s) => ({ states: { ...s.states, [floorId]: state } })),
  drop: (floorId) =>
    set((s) => {
      if (!(floorId in s.states)) return {};
      const { [floorId]: _gone, ...rest } = s.states;
      return { states: rest };
    }),
  clear: () => set({ states: {} }),
}));

export type FloorStoreHook = UseBoundStore<StoreApi<FloorStore>>;

const views = new Map<string, FloorStoreHook>();

/**
 * A read-only `FloorStore` view of one joined room, for scene layers that
 * take a floor store (robots, boards, laptops in a room the player is not
 * in). One per floor id, kept in step with `useRoomsStore`.
 */
export function roomFloorStore(floorId: string): FloorStoreHook {
  let view = views.get(floorId);
  if (view) return view;
  const read = () => useRoomsStore.getState().states[floorId] ?? null;
  const store = create<FloorStore>()(() => ({
    floorId,
    state: read(),
    apply: () => undefined,
    setFloorId: () => undefined,
    clear: () => undefined,
  }));
  useRoomsStore.subscribe((s, prev) => {
    const next = s.states[floorId] ?? null;
    if (next !== (prev.states[floorId] ?? null)) store.setState({ state: next });
  });
  view = store;
  views.set(floorId, view);
  return view;
}

/** "room=seat,seat|room2=..." for the joined rooms and their robots' desks, stable when nothing moved. */
export function occupancyKey(states: Readonly<Record<string, FloorState>>): string {
  return Object.keys(states)
    .sort()
    .map((id) => {
      const seats = Object.values(states[id]?.robots ?? {})
        .map((r) => r.seatId)
        .sort();
      return `${id}=${seats.join(",")}`;
    })
    .join("|");
}

export function parseOccupancy(key: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!key) return out;
  for (const part of key.split("|")) {
    const [id = "", seats = ""] = part.split("=");
    out.set(id, new Set(seats ? seats.split(",") : []));
  }
  return out;
}
