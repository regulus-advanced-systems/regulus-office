/**
 * Levels in the BuildingRoom (SPEC §14 D26; #268): which level an
 * `operation.go` leads to, and what happens to people on a level that is no
 * longer shown. Positions are per level, so every human presence carries the
 * level it is on.
 */
import {
  type BuildingStateSchema,
  HOLDING_LEVEL_ID,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
} from "@regulus/protocol";
import { type CompoundSnapshot, snapshotLevels } from "../../compound/room-state.ts";
import type { LairView } from "../../operations/access.ts";
import type { OperationRecord } from "./operations.ts";

type Humans = InstanceType<typeof BuildingStateSchema>["humans"];

/**
 * The level an `operation.go` leads to: the room's own level for a project
 * room (whatever the client named), else the named level if it is one being
 * shown, else the level the human is on. Null when the named level is not known.
 */
export function levelOfGo(
  known: readonly OperationRecord[],
  compound: CompoundSnapshot | undefined,
  operationId: string,
  named: string | undefined,
  current: string,
): string | null {
  if (operationId !== LOBBY_OPERATION_ID) {
    const record = known.find((f) => f.operationId === operationId);
    return record?.levelId ?? HOLDING_LEVEL_ID;
  }
  if (named === undefined) return current;
  if (named === LOBBY_LEVEL_ID) return named;
  const shown = compound ? snapshotLevels(compound).some((l) => l.levelId === named) : false;
  return shown ? named : null;
}

/**
 * Nobody stays where they may not be (D26, D27; #270): a person in a room that
 * is no longer open to them stands outside it, in the level's corridor, and a
 * person on a level they can no longer reach (or one that is no longer shown,
 * its last room archived) is back in the lobby. `viewOf` answers per session;
 * a session it does not know is left alone.
 */
export function returnToAllowedPlaces(
  humans: Humans,
  viewOf: (sessionId: string) => LairView | undefined,
): void {
  humans.forEach((human, sessionId) => {
    const view = viewOf(sessionId);
    if (!view) return;
    if (!view.levels.has(human.levelId)) {
      human.levelId = LOBBY_LEVEL_ID;
      human.operationId = LOBBY_OPERATION_ID;
      human.seatId = "";
    } else if (human.operationId !== LOBBY_OPERATION_ID && !view.rooms.has(human.operationId)) {
      human.operationId = LOBBY_OPERATION_ID;
      human.seatId = "";
    }
  });
}

/** The humans on one level, as the seat rules read them: a seat is held per level (#269). */
export function humansOn(
  humans: Humans,
  levelId: string,
): { forEach(cb: (human: ReturnType<Humans["get"]> & {}, sessionId: string) => void): void } {
  return {
    forEach(cb) {
      humans.forEach((human, sessionId) => {
        if (human.levelId === levelId) cb(human, sessionId);
      });
    },
  };
}
