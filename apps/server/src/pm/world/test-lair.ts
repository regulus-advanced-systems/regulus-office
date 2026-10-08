/**
 * A small lair for the world tests (#252): the lobby level with its fixed
 * rooms, and one organisation's level with its lift landing and two project rooms, Apollo and
 * Borealis, as a real `BuildingState`. Only imported by tests.
 */
import {
  BuildingStateSchema,
  HumanPresenceSchema,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  OperationSummarySchema,
} from "@regulus/protocol";
import {
  type CompoundRoomInput,
  compoundStateOf,
  computeCompoundLayout,
  defaultCompoundSpec,
  landingSpec,
  roomSummaryPlacement,
} from "@regulus/room-layout";
import { applyCompoundState, applyLevels } from "../../compound/room-state.ts";

export const ACME = "level-acme";
export const APOLLO = "op-apollo";
export const BOREALIS = "op-borealis";

const ROOMS: CompoundRoomInput[] = [
  { id: APOLLO, placement: { gridX: 8, gridY: 30, width: 8, depth: 8, doorSide: "south" } },
  { id: BOREALIS, placement: { gridX: 40, gridY: 30, width: 8, depth: 8, doorSide: "south" } },
];

export type TestState = InstanceType<typeof BuildingStateSchema>;

export function lairState(): TestState {
  const state = new BuildingStateSchema();
  const spec = defaultCompoundSpec();
  const lobbyLayout = computeCompoundLayout(spec, []);
  // A level other than the lobby level has the lift landing as its only fixed room (#269).
  const acmeLayout = computeCompoundLayout(landingSpec(spec), ROOMS);
  const lobby = compoundStateOf(lobbyLayout);
  applyCompoundState(state.compound, lobby);
  applyLevels(state.levels, {
    state: lobby,
    rooms: new Map(),
    levels: [
      { levelId: LOBBY_LEVEL_ID, kind: "lobby", login: "", name: "Lobby", order: 0, state: lobby },
      {
        levelId: ACME,
        kind: "org",
        login: "acme",
        name: "Acme",
        order: 1,
        state: compoundStateOf(acmeLayout),
      },
    ],
  });
  for (const room of acmeLayout.rooms) {
    const entry = new OperationSummarySchema();
    entry.operationId = room.id;
    entry.levelId = ACME;
    entry.name = room.id;
    Object.assign(entry, roomSummaryPlacement(room));
    entry.buildState = "ready";
    entry.deskCount = 2;
    entry.decorStyle = "ops_room";
    state.operations.set(room.id, entry);
  }
  return state;
}

/** Put a person in the lair (or move them): one session per user id. */
export function person(
  state: TestState,
  userId: string,
  at: { x: number; z: number; heading?: number; levelId?: string },
): void {
  let human = state.humans.get(userId);
  if (!human) {
    human = new HumanPresenceSchema();
    human.sessionId = userId;
    human.userId = userId;
    human.operationId = LOBBY_OPERATION_ID;
    human.joinedAt = 1;
    state.humans.set(userId, human);
  }
  human.levelId = at.levelId ?? LOBBY_LEVEL_ID;
  human.position.x = at.x;
  human.position.z = at.z;
  human.position.heading = at.heading ?? 0;
}
