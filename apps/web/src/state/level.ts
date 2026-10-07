/**
 * The level this viewer is looking at (SPEC §14 D26; #268). The lair has one
 * level per GitHub organisation or account plus the lobby level, each with
 * its own grid of rooms; the world shows one level at a time and quick
 * travel switches between them (the lift is #269). Everything drawn (the
 * compound world, other people, doors, seats, proximity voice) is the slice
 * of the BuildingRoom state for this level.
 */
import {
  type BuildingState,
  type ClosedRoom,
  type HumanPresence,
  type LevelState,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  sortLevels,
} from "@regulus/protocol";
import { create } from "zustand";

export interface LevelStore {
  levelId: string;
  set: (levelId: string) => void;
}

export const useLevelStore = create<LevelStore>()((set) => ({
  levelId: LOBBY_LEVEL_ID,
  set: (levelId) => set({ levelId }),
}));

type Levels = Pick<BuildingState, "compound" | "operations"> &
  Partial<Pick<BuildingState, "levels">>;

/** The published levels, lobby first; empty until the layout is published. */
export function levelList(state: Partial<Pick<BuildingState, "levels">> | null): LevelState[] {
  return sortLevels(Object.values(state?.levels ?? {}));
}

/** True when the viewed level is (still) published; the lobby level always is. */
export function isKnownLevel(
  state: Partial<Pick<BuildingState, "levels">> | null,
  levelId: string,
): boolean {
  return levelId === LOBBY_LEVEL_ID || Boolean(state?.levels?.[levelId]);
}

/**
 * The slice of the building state the world of one level is built from: that
 * level's layout and its rooms, plus the lobby entry (the same footprint on
 * every level; on other levels it is where the lift will arrive, #269).
 */
export function levelView(
  state: Levels | null,
  levelId: string,
): Pick<BuildingState, "compound" | "operations"> | null {
  if (!state) return null;
  const operations: BuildingState["operations"] = {};
  for (const [id, f] of Object.entries(state.operations)) {
    if (id === LOBBY_OPERATION_ID || f.levelId === levelId) operations[id] = f;
  }
  return { compound: state.levels?.[levelId]?.compound ?? state.compound, operations };
}

/**
 * The rooms on a level that are closed to this viewer (D26, #270): each is
 * an id and a footprint, nothing else. The scene draws them as closed doors
 * (#269); they are not in `operations`, so nothing that lists, enters or
 * previews rooms ever sees them.
 */
export function closedRoomsOnLevel(
  state: Partial<Pick<BuildingState, "closedRooms">> | null,
  levelId: string,
): ClosedRoom[] {
  return Object.values(state?.closedRooms ?? {}).filter((room) => room.levelId === levelId);
}

/** The level a room is on, from the published state. */
export function levelOfOperation(
  state: Pick<BuildingState, "operations"> | null,
  operationId: string,
): string | null {
  return state?.operations[operationId]?.levelId ?? null;
}

/**
 * People on the level this viewer is looking at: positions are per level.
 * A presence without a level (a server from before levels) is on the lobby level.
 */
export function onViewedLevel(human: Partial<Pick<HumanPresence, "levelId">>): boolean {
  return (human.levelId || LOBBY_LEVEL_ID) === useLevelStore.getState().levelId;
}

/** The humans of a building state that are on the viewed level, by session id. */
export function humansOnViewedLevel(
  state: Pick<BuildingState, "humans"> | null | undefined,
): Array<[string, HumanPresence]> {
  return Object.entries(state?.humans ?? {}).filter(([, h]) => onViewedLevel(h));
}
