/**
 * Per-viewer BuildingRoom state (SPEC D26, D27; #270). Everyone is in the
 * same BuildingRoom, but nobody receives anything about a room their own
 * GitHub access does not cover.
 *
 * How: the state's `humans`, `operations`, `closedRooms`, `levels`, `chat` and
 * `usage.topHenchmen` are per-viewer collections (Colyseus `.view()` with one
 * `StateView` per client). An entry is encoded for a client only while that
 * client was shown it, and a client that was shown nothing gets none of them,
 * so forgetting to call this module hides data instead of leaking it. This
 * module decides, for each client, which entries to show:
 *
 * - `operations`: the lobby, and the rooms the person may enter.
 * - `closedRooms`: rooms they may not enter on levels they reach (D26: seen
 *   from outside; id, level and footprint only).
 * - `levels`: the lobby level and the levels with a room they may enter.
 * - `humans`: themselves, and people on a level they reach who are not
 *   inside a room that is closed to them.
 * - `usage.topHenchmen`: henchmen of rooms they may enter.
 * - `chat`: lines written in the lobby or a corridor, and lines written
 *   inside a room they may enter (the same rule search applies to chat).
 *
 * The answer to "what may this person see" is `lairViewFor` in
 * operations/access.ts (the one gate); it is cached per person here and
 * dropped whenever rooms, levels or that person's access change.
 */
import { type BuildingStateSchema, LOBBY_LEVEL_ID, LOBBY_OPERATION_ID } from "@regulus/protocol";
import type { LairView } from "../../operations/access.ts";
import type { RoomAuthUser } from "../auth.ts";
import type { RoomClient, RoomHandle } from "../transport.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;

export interface ViewersDeps {
  /** What this person may see of the lair, from the access gate. */
  lairView(user: RoomAuthUser): LairView;
}

/** The lobby and nothing else: what a person without any room gets. */
export const LOBBY_ONLY: LairView = {
  rooms: new Map(),
  levels: new Set([LOBBY_LEVEL_ID]),
  linked: false,
};

/** May a viewer with `view` see a human who is on `levelId`, in `operationId`? */
export function seesHuman(view: LairView, human: { levelId: string; operationId: string }) {
  if (!view.levels.has(human.levelId || LOBBY_LEVEL_ID)) return false;
  return human.operationId === LOBBY_OPERATION_ID || view.rooms.has(human.operationId);
}

export function createViewers(deps: ViewersDeps) {
  /** By user id; dropped by `forget`. */
  const views = new Map<string, LairView>();
  /** By session id: the state entries this client was shown. */
  const shown = new Map<string, Set<object>>();
  /** The room each leaderboard row belongs to (not part of the state). */
  const rowRooms = new WeakMap<object, string>();

  const viewOf = (user: RoomAuthUser): LairView => {
    let view = views.get(user.userId);
    if (!view) {
      try {
        view = deps.lairView(user);
      } catch {
        // Fail closed: a person the gate cannot answer for sees the lobby only.
        view = LOBBY_ONLY;
      }
      views.set(user.userId, view);
    }
    return view;
  };

  const wantedBy = (state: BuildingState, client: RoomClient, present: Set<object>) => {
    const view = viewOf(client.user);
    const wanted = new Set<object>();
    state.operations.forEach((entry, id) => {
      present.add(entry);
      if (id === LOBBY_OPERATION_ID || view.rooms.has(id)) wanted.add(entry);
    });
    state.closedRooms.forEach((entry, id) => {
      present.add(entry);
      if (!view.rooms.has(id) && view.levels.has(entry.levelId)) wanted.add(entry);
    });
    state.levels.forEach((entry, id) => {
      present.add(entry);
      if (view.levels.has(id)) wanted.add(entry);
    });
    state.humans.forEach((human, sessionId) => {
      present.add(human);
      if (sessionId === client.sessionId || seesHuman(view, human)) wanted.add(human);
    });
    state.chat.forEach((line) => {
      present.add(line);
      const room = line.operationId;
      if (room === "" || room === LOBBY_OPERATION_ID || view.rooms.has(room)) wanted.add(line);
    });
    state.usage.topHenchmen.forEach((row) => {
      present.add(row);
      const room = rowRooms.get(row);
      if (room !== undefined && view.rooms.has(room)) wanted.add(row);
    });
    return wanted;
  };

  return {
    viewOf,

    /** Rooms, levels or a person's access changed: ask the gate again (for one person, or all). */
    forget(userId?: string): void {
      if (userId === undefined) views.clear();
      else views.delete(userId);
    },

    /** Say which room a leaderboard row is about, when the row is created. */
    tagRow(row: object, operationId: string): void {
      rowRooms.set(row, operationId);
    },

    /** Bring every client's view in line with the state and with what they may see. */
    sync(room: RoomHandle<BuildingState>): void {
      for (const client of room.clients) {
        const present = new Set<object>();
        const wanted = wantedBy(room.state, client, present);
        const had = shown.get(client.sessionId) ?? new Set<object>();
        for (const item of had) {
          // An entry already removed from the state is gone for everyone.
          if (!wanted.has(item) && present.has(item)) client.hide(item);
        }
        for (const item of wanted) if (!had.has(item)) client.show(item);
        shown.set(client.sessionId, wanted);
      }
    },

    /** A client left: nothing more is tracked for it. */
    drop(sessionId: string): void {
      shown.delete(sessionId);
    },

    clear(): void {
      shown.clear();
      views.clear();
    },
  };
}

export type Viewers = ReturnType<typeof createViewers>;
