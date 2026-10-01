/**
 * OperationRoom state of every joined room (SPEC §9.1 presence, #186): the room
 * the player is in and up to three nearby visible rooms, keyed by operation id.
 * The scene draws henchmen, boards and screens for each; the HUD keeps
 * reading `useOperationStore`, which mirrors only the room the player is in.
 */
import type { OperationState } from "@regulus/protocol";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OperationStore } from "./operation.ts";

export interface RoomsStore {
  states: Readonly<Record<string, OperationState>>;
  apply: (operationId: string, state: OperationState) => void;
  drop: (operationId: string) => void;
  clear: () => void;
}

export const useRoomsStore = create<RoomsStore>()((set) => ({
  states: {},
  apply: (operationId, state) => set((s) => ({ states: { ...s.states, [operationId]: state } })),
  drop: (operationId) =>
    set((s) => {
      if (!(operationId in s.states)) return {};
      const { [operationId]: _gone, ...rest } = s.states;
      return { states: rest };
    }),
  clear: () => set({ states: {} }),
}));

export type OperationStoreHook = UseBoundStore<StoreApi<OperationStore>>;

const views = new Map<string, OperationStoreHook>();

/**
 * A read-only `OperationStore` view of one joined room, for scene layers that
 * take an operation store (henchmen, boards, laptops in a room the player is not
 * in). One per operation id, kept in step with `useRoomsStore`.
 */
export function roomOperationStore(operationId: string): OperationStoreHook {
  let view = views.get(operationId);
  if (view) return view;
  const read = () => useRoomsStore.getState().states[operationId] ?? null;
  const store = create<OperationStore>()(() => ({
    operationId,
    state: read(),
    apply: () => undefined,
    setOperationId: () => undefined,
    clear: () => undefined,
  }));
  useRoomsStore.subscribe((s, prev) => {
    const next = s.states[operationId] ?? null;
    if (next !== (prev.states[operationId] ?? null)) store.setState({ state: next });
  });
  view = store;
  views.set(operationId, view);
  return view;
}

/** "room=seat,seat|room2=..." for the joined rooms and their henchmen's desks, stable when nothing moved. */
export function occupancyKey(states: Readonly<Record<string, OperationState>>): string {
  return Object.keys(states)
    .sort()
    .map((id) => {
      const seats = Object.values(states[id]?.henchmen ?? {})
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
