import { afterEach, describe, expect, test } from "bun:test";
import type { BuildingState, HumanPresence, LevelState, OperationInfo } from "@regulus/protocol";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { HEADING } from "@regulus/room-layout";
import { selectRemoteSessionIds } from "../scene/avatars/AvatarLayer.tsx";
import { liftOf } from "../scene/compound/lift/spot.ts";
import { rowPlacement, testState } from "../scene/compound/testing.ts";
import {
  arrivalRoomOf,
  compoundWorld,
  lobbyOf,
  roomAt,
  travelPose,
} from "../scene/compound/world.ts";
import { takenSeats } from "../scene/social/seats.ts";
import { useBuildingStore } from "./building.ts";
import { syncCompoundWorld, useCompoundStore } from "./compound.ts";
import {
  DRAFT_LEVEL_ID,
  draftLevelCompound,
  humansOnViewedLevel,
  isKnownLevel,
  levelLabel,
  levelLabelOf,
  levelList,
  levelOfOperation,
  levelView,
  sublevelOf,
  useLevelStore,
} from "./level.ts";
import { useOperationsStore } from "./operations.ts";
import { usePlayerStore } from "./player.ts";
import {
  leaveDraftLevel,
  showDraftLevel,
  showLevelWhenKnown,
  travelTo,
  travelToLevel,
} from "./travel.ts";

// Two owners' levels with a room on the very same tiles, and the lobby level with none.
const SPOT = rowPlacement(4);
const octo = testState([{ id: "apollo", placement: SPOT }], 48, { landing: true });
const acme = testState([{ id: "zeus", placement: SPOT }], 48, { landing: true });
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

  test("going to a level arrives at its lift landing, stepping out of the lift (#269)", () => {
    publish();
    expect(travelToLevel("lv-octo")).toBe(false); // not spawned yet
    usePlayerStore.getState().spawnAt({ x: 1, z: 1, heading: 0 }, "compound");
    expect(travelToLevel("lv-nope")).toBe(false);
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    expect(travelToLevel("lv-octo")).toBe(true);
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
    expect(projectRooms()).toEqual(["apollo"]);
    const world = useCompoundStore.getState().world;
    if (!world) throw new Error("no world");
    expect(world.levelId).toBe("lv-octo");
    // The level has its landing, not a copy of the lobby.
    expect(lobbyOf(world)).toBeUndefined();
    expect(arrivalRoomOf(world)?.kind).toBe("landing");
    const lift = liftOf(world);
    if (!lift) throw new Error("no lift");
    const p = usePlayerStore.getState();
    expect({ x: p.x, z: p.z, heading: p.heading }).toEqual(lift.stand);
    expect(p.heading).toBe(HEADING.west);
    expect(roomAt(world, p.x, p.z)?.kind).toBe("landing");
    // Back up: the same shaft, so the same spot, now in the lobby.
    expect(travelToLevel(LOBBY_LEVEL_ID)).toBe(true);
    const lobbyWorld = useCompoundStore.getState().world;
    if (!lobbyWorld) throw new Error("no world");
    const back = usePlayerStore.getState();
    expect({ x: back.x, z: back.z }).toEqual({ x: p.x, z: p.z });
    expect(roomAt(lobbyWorld, back.x, back.z)?.kind).toBe("lobby");
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
    // The landing of the level one is on; the landing of a named level.
    expect(travelTo("landing")).toBe(true);
    expect(useLevelStore.getState().levelId).toBe("lv-acme");
    expect(travelTo("landing", { levelId: "lv-octo" })).toBe(true);
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
    // The lobby, the war room and the break room are on the lobby level only (#269).
    expect(travelTo("conference")).toBe(true);
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    useLevelStore.getState().set("lv-acme");
    syncCompoundWorld();
    expect(travelTo("lobby")).toBe(true);
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
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

describe("what a level is called (#269)", () => {
  const levels = levelList(building(LEVELS));

  test("sublevels are counted down the levels the viewer is shown, lobby first", () => {
    expect(levels.map((l) => [l.levelId, sublevelOf(levels, l.levelId)])).toEqual([
      [LOBBY_LEVEL_ID, 0],
      ["lv-octo", 1],
      ["lv-acme", 2],
    ]);
    // A level the viewer may not reach is not published: no gap where it would be.
    const without = levels.filter((l) => l.levelId !== "lv-octo");
    expect(sublevelOf(without, "lv-acme")).toBe(1);
    expect(sublevelOf(without, "lv-octo")).toBe(0);
  });

  test("the lobby level, organisations, accounts and the holding level", () => {
    const label = (id: string) => levelLabelOf(building(LEVELS), id);
    expect(label(LOBBY_LEVEL_ID)).toMatchObject({ mark: "L", title: "Lobby level" });
    expect(label("lv-octo")).toEqual({
      mark: "S1",
      title: "octo",
      caption: "Sublevel 1 · GitHub organisation",
    });
    expect(label("lv-acme")?.caption).toBe("Sublevel 2 · GitHub account");
    expect(label("lv-nope")).toBeNull();
    const named = levelLabel(
      { levelId: "x", kind: "org", login: "regulus-advanced-systems", name: "Regulus", order: 1 },
      [],
    );
    expect(named.caption).toContain("regulus-advanced-systems");
    const holding = level("holding", "holding", "", 65535, acme.compound);
    expect(levelLabel({ ...holding, name: "Unassigned" }, [...levels, holding])).toEqual({
      mark: "S3",
      title: "Holding level",
      caption: "Sublevel 3 · rooms with no repo yet",
    });
  });
});

describe("the draft of a new level (#269)", () => {
  test("is the empty grid a new owner's level will have: the lift landing, no lobby rooms", () => {
    publish();
    usePlayerStore.getState().spawnAt({ x: 1, z: 1, heading: 0 }, "compound");
    useLevelStore.getState().set("lv-octo");
    syncCompoundWorld();
    showDraftLevel();
    expect(useLevelStore.getState().levelId).toBe(DRAFT_LEVEL_ID);
    const world = useCompoundStore.getState().world;
    expect(world?.rooms.map((r) => r.kind)).toEqual(["landing"]);
    expect(world?.blastDoor.width).toBe(0);
    expect(world?.outsideDepth).toBe(0);
    expect(arrivalRoomOf(world as NonNullable<typeof world>)?.rect).toEqual(
      lobbyOf(compoundWorld(lobby, null) as NonNullable<ReturnType<typeof compoundWorld>>)?.rect,
    );
    expect(levelLabelOf(building(LEVELS), DRAFT_LEVEL_ID)?.title).toBe("New level");
    // Nobody travels to it, and leaving goes back to where the viewer was.
    expect(travelToLevel(DRAFT_LEVEL_ID)).toBe(false);
    leaveDraftLevel();
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
    leaveDraftLevel();
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
  });

  test("the same layout object is reused for one lobby layout", () => {
    expect(draftLevelCompound(lobby.compound)).toBe(draftLevelCompound(lobby.compound));
    expect(draftLevelCompound(lobby.compound).version).not.toBe(lobby.compound.version);
  });
});
