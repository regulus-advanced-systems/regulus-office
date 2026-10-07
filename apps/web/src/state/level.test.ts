import { afterEach, describe, expect, test } from "bun:test";
import type { BuildingState, HumanPresence, LevelState, OperationInfo } from "@regulus/protocol";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { selectRemoteSessionIds } from "../scene/avatars/AvatarLayer.tsx";
import { rowPlacement, testState } from "../scene/compound/testing.ts";
import { lobbyOf, travelPose } from "../scene/compound/world.ts";
import { takenSeats } from "../scene/social/seats.ts";
import { useBuildingStore } from "./building.ts";
import { syncCompoundWorld, useCompoundStore } from "./compound.ts";
import {
  humansOnViewedLevel,
  isKnownLevel,
  levelList,
  levelOfOperation,
  levelView,
  useLevelStore,
} from "./level.ts";
import { useOperationsStore } from "./operations.ts";
import { usePlayerStore } from "./player.ts";
import { showLevelWhenKnown, travelTo, travelToLevel } from "./travel.ts";

// Two owners' levels with a room on the very same tiles, and the lobby level with none.
const SPOT = rowPlacement(4);
const octo = testState([{ id: "apollo", placement: SPOT }]);
const acme = testState([{ id: "zeus", placement: SPOT }]);
const lobby = testState([]);
const level = (
  levelId: string,
  kind: LevelState["kind"],
  login: string,
  order: number,
  compound: LevelState["compound"],
): LevelState => ({ levelId, kind, login, name: login || "Lobby", order, compound });
const human = (id: string, levelId: string, seatId = ""): HumanPresence =>
  ({ sessionId: id, levelId, seatId, position: { x: 1, z: 1, heading: 0 } }) as HumanPresence;

function building(levels: LevelState[]): BuildingState {
  return {
    compound: lobby.compound,
    levels: Object.fromEntries(levels.map((l) => [l.levelId, l])),
    operations: {
      ...lobby.operations,
      apollo: { ...octo.operations.apollo, levelId: "lv-octo" },
      zeus: { ...acme.operations.zeus, levelId: "lv-acme" },
    },
    humans: {
      me: human("me", LOBBY_LEVEL_ID),
      here: human("here", LOBBY_LEVEL_ID, "lobby/sofa-1"),
      there: human("there", "lv-octo", "lobby/sofa-2"),
    },
  } as unknown as BuildingState;
}
const LEVELS = [
  level("lv-acme", "account", "acme", 2, acme.compound),
  level(LOBBY_LEVEL_ID, "lobby", "", 0, lobby.compound),
  level("lv-octo", "org", "octo", 1, octo.compound),
];

function publish(levels = LEVELS) {
  useBuildingStore.setState({ state: building(levels), sessionId: "me" });
  useOperationsStore.setState({
    operations: ["apollo", "zeus"].map((operationId) => ({ operationId }) as OperationInfo),
  });
  syncCompoundWorld();
}
const projectRooms = () =>
  (useCompoundStore.getState().world?.rooms ?? [])
    .filter((r) => r.kind === "project")
    .map((r) => r.id);

afterEach(() => {
  useLevelStore.setState({ levelId: LOBBY_LEVEL_ID });
  useBuildingStore.getState().clear();
  useOperationsStore.setState({ operations: null });
  useCompoundStore.setState({ world: null });
  usePlayerStore.getState().reset();
});

describe("levels (#268)", () => {
  test("the world is one level at a time: its layout and its rooms only", () => {
    publish();
    expect(levelList(useBuildingStore.getState().state).map((l) => l.levelId)).toEqual([
      LOBBY_LEVEL_ID,
      "lv-octo",
      "lv-acme",
    ]);
    // The lobby level has the fixed rooms and no project rooms.
    expect(projectRooms()).toEqual([]);
    expect(useCompoundStore.getState().world?.version).toBe(lobby.compound.version);
    useLevelStore.getState().set("lv-octo");
    syncCompoundWorld();
    expect(projectRooms()).toEqual(["apollo"]);
    expect(useCompoundStore.getState().world?.version).toBe(octo.compound.version);
    const view = levelView(useBuildingStore.getState().state, "lv-acme");
    expect(Object.keys(view?.operations ?? {}).sort()).toEqual(["lobby", "zeus"]);
    expect(view?.compound).toBe(acme.compound);
    expect(levelOfOperation(useBuildingStore.getState().state, "zeus")).toBe("lv-acme");
  });

  test("the level switch puts the player at the lobby door of that level", () => {
    publish();
    expect(travelToLevel("lv-octo")).toBe(false); // not spawned yet
    usePlayerStore.getState().spawnAt({ x: 1, z: 1, heading: 0 }, "compound");
    expect(travelToLevel("lv-nope")).toBe(false);
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    expect(travelToLevel("lv-octo")).toBe(true);
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
    expect(projectRooms()).toEqual(["apollo"]);
    const world = useCompoundStore.getState().world;
    const door = world ? lobbyOf(world) : undefined;
    if (!door) throw new Error("no lobby");
    const p = usePlayerStore.getState();
    expect({ x: p.x, z: p.z, heading: p.heading }).toEqual(travelPose(door));
  });

  test("quick travel to a room on another level goes to that level", () => {
    publish();
    usePlayerStore.getState().spawnAt({ x: 1, z: 1, heading: 0 }, "compound");
    expect(travelTo("zeus")).toBe(true);
    expect(useLevelStore.getState().levelId).toBe("lv-acme");
    expect(projectRooms()).toEqual(["zeus"]);
    const zeus = useCompoundStore.getState().world?.rooms.find((r) => r.id === "zeus");
    if (!zeus) throw new Error("no room");
    const p = usePlayerStore.getState();
    expect({ x: p.x, z: p.z }).toEqual({ x: travelPose(zeus).x, z: travelPose(zeus).z });
    // The lobby is on every level: travelling there stays on this one.
    expect(travelTo("lobby")).toBe(true);
    expect(useLevelStore.getState().levelId).toBe("lv-acme");
  });

  test("people, seats and voice are those of the level being looked at", () => {
    publish();
    const state = useBuildingStore.getState().state;
    const ids = () => humansOnViewedLevel(state).map(([id]) => id);
    expect(ids()).toEqual(["me", "here"]);
    expect(selectRemoteSessionIds(useBuildingStore.getState())).toEqual(["here"]);
    expect([...takenSeats(state, "me")]).toEqual(["lobby/sofa-1"]);
    useLevelStore.getState().set("lv-octo");
    expect(ids()).toEqual(["there"]);
    expect(selectRemoteSessionIds(useBuildingStore.getState())).toEqual(["there"]);
    expect([...takenSeats(state, "me")]).toEqual(["lobby/sofa-2"]);
  });

  test("a level that goes away leaves its viewers on the lobby level", () => {
    publish();
    useLevelStore.getState().set("lv-acme");
    syncCompoundWorld();
    expect(projectRooms()).toEqual(["zeus"]);
    publish(LEVELS.filter((l) => l.levelId !== "lv-acme"));
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    expect(isKnownLevel(useBuildingStore.getState().state, "lv-acme")).toBe(false);
  });

  test("a level made by a new room is shown as soon as the building publishes it", () => {
    publish(LEVELS.filter((l) => l.levelId !== "lv-acme"));
    showLevelWhenKnown("lv-acme");
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    useBuildingStore.setState({ state: building(LEVELS) });
    expect(useLevelStore.getState().levelId).toBe("lv-acme");
    expect(projectRooms()).toEqual(["zeus"]);
  });
});
