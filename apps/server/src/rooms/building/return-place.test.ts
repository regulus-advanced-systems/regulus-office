/**
 * Whether a remembered place may be taken up again (#262): the access gate's
 * answer and what walking allows decide, never what was stored.
 */
import { expect, test } from "bun:test";
import { LOBBY_LEVEL_ID, LOBBY_OPERATION_ID, type OperationAccess } from "@regulus/protocol";
import { doorApproach } from "@regulus/room-layout";
import type { LairView } from "../../operations/access.ts";
import { ACME, APOLLO, BOREALIS, lairState } from "../../pm/world/test-lair.ts";
import { placeToReturnTo, type ReturnPlace } from "./return-place.ts";

/** What the gate says for someone whose GitHub access covers these rooms. */
function viewOf(rooms: Record<string, OperationAccess>, levels: string[] = [ACME]): LairView {
  return {
    rooms: new Map(Object.entries(rooms)),
    levels: new Set([LOBBY_LEVEL_ID, ...(Object.keys(rooms).length > 0 ? levels : [])]),
    linked: true,
  };
}

/** The middle of Apollo (tiles 8..16 × 30..38 on Acme's level), compound metres. */
const IN_APOLLO: ReturnPlace = { levelId: ACME, operationId: APOLLO, x: 24, z: 68, heading: 1 };
/** The corridor in front of Apollo's door. */
const corridor = doorApproach({ x: 8, y: 30, w: 8, d: 8 }, "south");
const AT_APOLLOS_DOOR: ReturnPlace = {
  levelId: ACME,
  operationId: LOBBY_OPERATION_ID,
  x: corridor.x,
  z: corridor.z,
  heading: corridor.heading,
};
/** The middle of the lobby (tiles 26..38 × 56..64 on the lobby level). */
const IN_LOBBY: ReturnPlace = {
  levelId: LOBBY_LEVEL_ID,
  operationId: LOBBY_OPERATION_ID,
  x: 64,
  z: 120,
  heading: -2,
};
/** On the beach, south of the blast door. */
const ON_BEACH: ReturnPlace = { ...IN_LOBBY, z: 131 };

const both = viewOf({ [APOLLO]: "spawn", [BOREALIS]: "view" });

test("a room that is still open to the person: the same level, room, spot and facing", () => {
  expect(placeToReturnTo(lairState(), both, IN_APOLLO)).toEqual(IN_APOLLO);
  expect(placeToReturnTo(lairState(), viewOf({ [APOLLO]: "view" }), IN_APOLLO)).toEqual(IN_APOLLO);
});

test("a corridor of a level they reach, and the lobby for anyone", () => {
  expect(placeToReturnTo(lairState(), both, AT_APOLLOS_DOOR)).toEqual(AT_APOLLOS_DOOR);
  // The corridor is theirs even when the room behind the door is not.
  expect(placeToReturnTo(lairState(), viewOf({ [BOREALIS]: "view" }), AT_APOLLOS_DOOR)).toEqual(
    AT_APOLLOS_DOOR,
  );
  // No GitHub link at all: the lobby level only, and the lobby is on it.
  expect(placeToReturnTo(lairState(), viewOf({}), IN_LOBBY)).toEqual(IN_LOBBY);
});

test("the facing is brought back into range", () => {
  const back = placeToReturnTo(lairState(), both, { ...IN_LOBBY, heading: 3 * Math.PI });
  expect(back?.heading).toBeCloseTo(-Math.PI, 6);
});

test("the room was closed to them: refused, although the level is still theirs", () => {
  expect(placeToReturnTo(lairState(), viewOf({ [BOREALIS]: "manage" }), IN_APOLLO)).toBeNull();
});

test("the level was closed to them: refused, room and corridor alike", () => {
  const lobbyOnly = viewOf({});
  expect(placeToReturnTo(lairState(), lobbyOnly, IN_APOLLO)).toBeNull();
  expect(placeToReturnTo(lairState(), lobbyOnly, AT_APOLLOS_DOOR)).toBeNull();
});

test("a level that is not shown any more is refused", () => {
  const view = viewOf({ [APOLLO]: "spawn" }, ["level-gone"]);
  expect(placeToReturnTo(lairState(), view, { ...IN_APOLLO, levelId: "level-gone" })).toBeNull();
  // Even if the gate still listed it: there is nothing to stand on.
  const state = lairState();
  state.levels.delete(ACME);
  expect(placeToReturnTo(state, both, IN_APOLLO)).toBeNull();
});

test("the room was deleted or archived: refused", () => {
  const state = lairState();
  state.operations.delete(APOLLO);
  expect(placeToReturnTo(state, both, IN_APOLLO)).toBeNull();
});

test("the room was moved: refused, at the old spot and whatever stands there now", () => {
  const state = lairState();
  const apollo = state.operations.get(APOLLO);
  const borealis = state.operations.get(BOREALIS);
  if (!apollo || !borealis) throw new Error("the test lair lost its rooms");
  // Apollo and Borealis swap places: Borealis now stands where the person left Apollo.
  const { gridX, doorX } = apollo;
  apollo.gridX = borealis.gridX;
  apollo.doorX = borealis.doorX;
  borealis.gridX = gridX;
  borealis.doorX = doorX;
  expect(placeToReturnTo(state, both, IN_APOLLO)).toBeNull();
});

test("a room that is being built again is shut", () => {
  const state = lairState();
  const apollo = state.operations.get(APOLLO);
  if (!apollo) throw new Error("no Apollo");
  apollo.buildState = "building";
  expect(placeToReturnTo(state, both, IN_APOLLO)).toBeNull();
});

test("the room is read from the spot, not from what was stored", () => {
  // "In no room", at a spot inside a room that is closed to them.
  const sneak = { ...IN_APOLLO, operationId: LOBBY_OPERATION_ID };
  expect(placeToReturnTo(lairState(), viewOf({ [BOREALIS]: "view" }), sneak)).toBeNull();
  // The same lie about a room that is open to them is still not where they were.
  expect(placeToReturnTo(lairState(), both, sneak)).toBeNull();
  // "In Apollo", standing in the corridor; "in Borealis", standing in Apollo.
  expect(
    placeToReturnTo(lairState(), both, { ...AT_APOLLOS_DOOR, operationId: APOLLO }),
  ).toBeNull();
  expect(placeToReturnTo(lairState(), both, { ...IN_APOLLO, operationId: BOREALIS })).toBeNull();
});

test("another level's coordinates are checked against that level", () => {
  // Apollo's spot is solid rock on the lobby level.
  const onLobbyLevel = { ...IN_APOLLO, levelId: LOBBY_LEVEL_ID, operationId: LOBBY_OPERATION_ID };
  expect(placeToReturnTo(lairState(), both, onLobbyLevel)).toBeNull();
});

test("inside a wall, in the rock, or off the map: refused", () => {
  // The north wall of Apollo (the room's edge row), and the lobby's west wall.
  expect(placeToReturnTo(lairState(), both, { ...IN_APOLLO, z: 60.1 })).toBeNull();
  expect(placeToReturnTo(lairState(), both, { ...IN_LOBBY, x: 52.1 })).toBeNull();
  // Rock between the rooms.
  expect(placeToReturnTo(lairState(), both, { ...AT_APOLLOS_DOOR, x: 2, z: 2 })).toBeNull();
  expect(placeToReturnTo(lairState(), both, { ...IN_LOBBY, x: -5 })).toBeNull();
  expect(placeToReturnTo(lairState(), both, { ...IN_LOBBY, x: 1e9 })).toBeNull();
  expect(placeToReturnTo(lairState(), both, { ...IN_LOBBY, z: Number.NaN })).toBeNull();
  expect(
    placeToReturnTo(lairState(), both, { ...IN_LOBBY, heading: Number.POSITIVE_INFINITY }),
  ).toBeNull();
});

test("the beach is behind the blast door: only while it is open", () => {
  const state = lairState();
  expect(placeToReturnTo(state, both, ON_BEACH)).toBeNull();
  state.blastDoor.phase = "open";
  expect(placeToReturnTo(state, both, ON_BEACH)).toEqual(ON_BEACH);
});

test("before the lair is published nothing is allowed", () => {
  const state = lairState();
  state.levels.clear();
  state.compound.width = 0;
  expect(placeToReturnTo(state, both, IN_LOBBY)).toBeNull();
});
