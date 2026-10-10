import { afterEach, describe, expect, test } from "bun:test";
import type { BuildingState, HumanPresence, LevelState, OperationInfo } from "@regulus/protocol";
import { LOBBY_LEVEL_ID } from "@regulus/protocol";
import { compoundNavGrid, lobbySpawn } from "../scene/compound/navigation.ts";
import { rowPlacement, testState } from "../scene/compound/testing.ts";
import { roomAt, roomCentre } from "../scene/compound/world.ts";
import { arrivalPose } from "./arrival.ts";
import { useBuildingStore } from "./building.ts";
import { syncCompoundWorld, useCompoundStore } from "./compound.ts";
import { useLevelStore } from "./level.ts";
import { useOperationsStore } from "./operations.ts";
import { usePlayerStore } from "./player.ts";

// The lobby level, and Octo's level with Apollo on it.
const octo = testState([{ id: "apollo", placement: rowPlacement(4) }], 48, { landing: true });
const lobby = testState([]);
const level = (
  levelId: string,
  kind: LevelState["kind"],
  compound: LevelState["compound"],
): LevelState => ({ levelId, kind, login: "", name: levelId, order: 0, compound });

/** The building state this client received, with its own presence where the server put it. */
function publish(me: Pick<HumanPresence, "levelId" | "operationId" | "position"> | null) {
  const state = {
    compound: lobby.compound,
    levels: {
      [LOBBY_LEVEL_ID]: level(LOBBY_LEVEL_ID, "lobby", lobby.compound),
      "lv-octo": level("lv-octo", "org", octo.compound),
    },
    operations: {
      ...lobby.operations,
      apollo: { ...octo.operations.apollo, levelId: "lv-octo" },
    },
    humans: me ? { me: { sessionId: "me", seatId: "", ...me } } : {},
  } as unknown as BuildingState;
  useBuildingStore.setState({ state, sessionId: "me" });
  useOperationsStore.setState({ operations: [{ operationId: "apollo" } as OperationInfo] });
  syncCompoundWorld();
}

/** What the scene does when it first mounts: spawn the player in the world it was given. */
function firstSpawn() {
  const world = useCompoundStore.getState().world;
  if (!world) throw new Error("no world");
  const grid = compoundNavGrid(world);
  const pose = arrivalPose(world, grid, lobbySpawn(world));
  usePlayerStore.getState().spawnAt(pose, "compound");
  return { world, grid, pose };
}

afterEach(() => {
  useLevelStore.setState({ levelId: LOBBY_LEVEL_ID });
  useBuildingStore.getState().clear();
  useOperationsStore.setState({ operations: null });
  useCompoundStore.setState({ world: null });
  usePlayerStore.getState().reset();
});

describe("arriving where the building has us (#262)", () => {
  test("on another level, in a room: that level's world, that spot, that facing", () => {
    // The middle of Apollo, tiles → metres.
    const apollo = octo.operations.apollo;
    if (!apollo) throw new Error("no apollo");
    const at = {
      x: (apollo.gridX + apollo.width / 2) * 2 + 0.6,
      z: (apollo.gridY + apollo.depth / 2) * 2 + 1.1,
    };
    publish({ levelId: "lv-octo", operationId: "apollo", position: { ...at, heading: 1.5 } });
    expect(useLevelStore.getState().levelId).toBe("lv-octo");
    const { world, grid, pose } = firstSpawn();
    expect(world.levelId).toBe("lv-octo");
    expect(roomAt(world, pose.x, pose.z)?.id).toBe("apollo");
    expect(pose.heading).toBe(1.5);
    // On the floor of this client's grid, at most a nav cell away from where the server said.
    expect(grid.isWalkable(pose.x, pose.z)).toBe(true);
    expect(Math.hypot(pose.x - at.x, pose.z - at.z)).toBeLessThan(1.5);
  });

  test("in the lobby, away from the usual spot", () => {
    publish(null);
    const world = useCompoundStore.getState().world;
    if (!world) throw new Error("no world");
    const usual = lobbySpawn(world);
    const position = { x: usual.x - 3, z: usual.z - 1, heading: -1 };
    publish({ levelId: LOBBY_LEVEL_ID, operationId: "lobby", position });
    const { pose, grid } = firstSpawn();
    expect(grid.isWalkable(pose.x, pose.z)).toBe(true);
    expect(Math.hypot(pose.x - position.x, pose.z - position.z)).toBeLessThan(1.5);
    expect(pose.heading).toBe(-1);
  });

  test("at the lobby spawn (nothing remembered, or the place was refused): the usual spawn", () => {
    publish(null);
    const world = useCompoundStore.getState().world;
    if (!world) throw new Error("no world");
    const usual = lobbySpawn(world);
    publish({ levelId: LOBBY_LEVEL_ID, operationId: "lobby", position: usual });
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    expect(firstSpawn().pose).toEqual(usual);
  });

  test("no presence yet, or a spot this client cannot stand on: the usual spawn", () => {
    publish(null);
    const world = useCompoundStore.getState().world;
    if (!world) throw new Error("no world");
    const grid = compoundNavGrid(world);
    const usual = lobbySpawn(world);
    expect(arrivalPose(world, grid, usual)).toEqual(usual);
    publish({
      levelId: LOBBY_LEVEL_ID,
      operationId: "lobby",
      position: { x: 1, z: 1, heading: 0 },
    });
    expect(arrivalPose(world, grid, usual)).toEqual(usual);
  });

  test("a level that is not published to us is not looked at", () => {
    publish({
      levelId: "lv-gone",
      operationId: "lobby",
      position: { x: 30, z: 30, heading: 0 },
    });
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    const { world, pose } = firstSpawn();
    expect(pose).toEqual(lobbySpawn(world));
  });

  test("only the first spawn: afterwards the client says where the player is", () => {
    publish({
      levelId: LOBBY_LEVEL_ID,
      operationId: "lobby",
      position: { x: 0, z: 0, heading: 0 },
    });
    const { world, grid } = firstSpawn();
    const usual = lobbySpawn(world);
    // A reconnect: the building has us back on Octo's level, but the player is already here.
    const centre = roomCentre(world.rooms[0] as NonNullable<(typeof world.rooms)[0]>);
    publish({ levelId: "lv-octo", operationId: "lobby", position: { ...centre, heading: 2 } });
    expect(useLevelStore.getState().levelId).toBe(LOBBY_LEVEL_ID);
    expect(arrivalPose(world, grid, usual)).toEqual(usual);
  });
});
