/**
 * The level this viewer is on (SPEC §14 D26; #268, #269). The lair has one
 * level per GitHub organisation or account plus the lobby level, each with
 * its own grid of rooms, dug into the same mountain; the world shows one
 * level at a time, and the lift and quick travel go between them
 * (travel.ts). Everything drawn (the compound world, other people, doors,
 * seats, proximity voice) is the slice of the BuildingRoom state for this
 * level. Only levels the server publishes exist here: a level this viewer
 * may not reach is simply absent.
 */
import {
  type BuildingState,
  type ClosedRoom,
  type HumanPresence,
  type LevelInfo,
  type LevelState,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  sortLevels,
} from "@regulus/protocol";
import { compoundStateOf, computeCompoundLayout, landingSpec } from "@regulus/room-layout";
import { create } from "zustand";

export interface LevelStore {
  levelId: string;
  set: (levelId: string) => void;
}

export const useLevelStore = create<LevelStore>()((set) => ({
  levelId: LOBBY_LEVEL_ID,
  set: (levelId) => set({ levelId }),
}));

/**
 * A level that does not exist yet (#269): the first room of a GitHub owner
 * opens a new level, and build mode places that room on its empty grid (the
 * lift landing and nothing else) before the server has made the level. Only
 * this client looks at it; the building is never told.
 */
export const DRAFT_LEVEL_ID = "draft-level";

const drafts = new WeakMap<object, BuildingState["compound"]>();

/** The layout of a level with no rooms yet, from the lobby level's (same grid, same lift shaft). */
export function draftLevelCompound(lobby: BuildingState["compound"]): BuildingState["compound"] {
  const hit = drafts.get(lobby);
  if (hit) return hit;
  const room = lobby.specialRooms.find((s) => s.kind === "lobby");
  if (!room || lobby.width === 0) return lobby;
  const spec = landingSpec({
    width: lobby.width,
    depth: lobby.depth,
    lobby: { x: room.gridX, y: room.gridY, w: room.width, d: room.depth },
  });
  const compound = compoundStateOf(computeCompoundLayout(spec, []));
  drafts.set(lobby, compound);
  return compound;
}

type Levels = Pick<BuildingState, "compound" | "operations"> &
  Partial<Pick<BuildingState, "levels" | "closedRooms">>;

/** The published levels, lobby first; empty until the layout is published. */
export function levelList(state: Partial<Pick<BuildingState, "levels">> | null): LevelState[] {
  return sortLevels(Object.values(state?.levels ?? {}));
}

/**
 * True when the viewed level is (still) published; the lobby level always is,
 * and so is the draft of a level about to be made (never one to travel to).
 */
export function isKnownLevel(
  state: Partial<Pick<BuildingState, "levels">> | null,
  levelId: string,
): boolean {
  return (
    levelId === LOBBY_LEVEL_ID || levelId === DRAFT_LEVEL_ID || Boolean(state?.levels?.[levelId])
  );
}

/**
 * The slice of the building state the world of one level is built from: that
 * level's layout (its own fixed rooms: the lobby's on the lobby level, the
 * lift landing elsewhere) and its rooms, plus the lobby entry, whose
 * counters the lobby level's lobby shows.
 */
export function levelView(
  state: Levels | null,
  levelId: string,
): (Pick<BuildingState, "compound" | "operations"> & { closedRooms: ClosedRoom[] }) | null {
  if (!state) return null;
  const operations: BuildingState["operations"] = {};
  for (const [id, f] of Object.entries(state.operations)) {
    if (id === LOBBY_OPERATION_ID || f.levelId === levelId) operations[id] = f;
  }
  const lobby = state.levels?.[LOBBY_LEVEL_ID]?.compound ?? state.compound;
  if (levelId === DRAFT_LEVEL_ID)
    return { compound: draftLevelCompound(lobby), operations, closedRooms: [] };
  return {
    compound: state.levels?.[levelId]?.compound ?? state.compound,
    operations,
    closedRooms: closedRoomsOnLevel(state, levelId),
  };
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

export interface LevelLabel {
  /** Two or three characters for the lift's indicator: `L`, `S1`, `S2`... */
  mark: string;
  /** The level's name: the organisation or account, "Lobby level". */
  title: string;
  /** One line under it: how deep it is and whose it is. */
  caption: string;
}

/**
 * How deep a level is for this viewer: 0 for the lobby level, then 1, 2, ...
 * down the levels this viewer can reach, in lift order. Counted over what
 * the viewer is shown, so a level they may not reach leaves no gap.
 */
export function sublevelOf(levels: readonly Pick<LevelInfo, "levelId">[], levelId: string): number {
  if (levelId === LOBBY_LEVEL_ID) return 0;
  const below = levels.filter((l) => l.levelId !== LOBBY_LEVEL_ID);
  return below.findIndex((l) => l.levelId === levelId) + 1;
}

/** What a level is called on the lift, in quick travel and in "who's where". */
export function levelLabel(level: LevelInfo, levels: readonly LevelInfo[]): LevelLabel {
  if (level.kind === "lobby")
    return { mark: "L", title: "Lobby level", caption: "Reception, war room, break room, beach" };
  const n = sublevelOf(levels, level.levelId);
  const depth = `Sublevel ${n}`;
  if (level.kind === "holding")
    return { mark: `S${n}`, title: "Holding level", caption: `${depth} · rooms with no repo yet` };
  const owner = level.kind === "org" ? "organisation" : "account";
  const login = level.login && level.login !== level.name.toLowerCase() ? ` · ${level.login}` : "";
  return { mark: `S${n}`, title: level.name, caption: `${depth} · GitHub ${owner}${login}` };
}

/** What the draft of a new level is called while its first room is being placed. */
export const DRAFT_LEVEL_LABEL: LevelLabel = {
  mark: "··",
  title: "New level",
  caption: "Opens with this room",
};

/** The label of the level with this id among the published levels, or null when it is not one. */
export function levelLabelOf(
  state: Partial<Pick<BuildingState, "levels">> | null,
  levelId: string,
): LevelLabel | null {
  if (levelId === DRAFT_LEVEL_ID) return DRAFT_LEVEL_LABEL;
  const levels = levelList(state);
  const level = levels.find((l) => l.levelId === levelId);
  return level ? levelLabel(level, levels) : null;
}
