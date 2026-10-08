import { describe, expect, test } from "bun:test";
import type { CompoundState, LevelState, OperationInfo, OperationSummary } from "@regulus/protocol";
import { closedRoomOf, rowPlacement, testState, testWorld } from "../../scene/compound/testing.ts";
import { compoundWorld } from "../../scene/compound/world.ts";
import { levelView } from "../../state/level.ts";
import { anyCloning, cloneBadge } from "../../state/operations.ts";
import { levelDepth, travelGroups, travelRooms } from "./QuickTravel.tsx";

describe("quick travel rooms (#186)", () => {
  test("special rooms first, then finished rooms this viewer may enter", () => {
    const world = testWorld(
      [
        { id: "apollo", placement: rowPlacement(4) },
        { id: "hermes", placement: rowPlacement(16), building: true },
        { id: "zeus", placement: rowPlacement(28) },
      ],
      ["apollo", "hermes"],
    );
    expect(travelRooms(world.rooms).map((r) => r.id)).toEqual([
      "lobby",
      "conference",
      "break_room",
      "apollo",
    ]);
  });

  test("rooms are grouped by level: the level one is on first, then lift order (#268, #269)", () => {
    const spot = rowPlacement(4);
    const octo = testState([{ id: "apollo", placement: spot }], 48, { landing: true });
    const acme = testState(
      [
        { id: "zeus", placement: spot },
        { id: "hades", placement: rowPlacement(16) },
        { id: "vault", placement: rowPlacement(28) },
      ],
      48,
      { landing: true },
    );
    const lobby = testState([]);
    const level = (levelId: string, name: string, order: number, compound: CompoundState) =>
      ({ levelId, kind: "org", login: name.toLowerCase(), name, order, compound }) as LevelState;
    const state = {
      compound: lobby.compound,
      levels: {
        acme: level("acme", "Acme", 2, acme.compound),
        octo: level("octo", "Octo", 1, octo.compound),
        lobby: { ...level("lobby", "Lobby", 0, lobby.compound), kind: "lobby", login: "" },
      },
      operations: {
        ...lobby.operations,
        apollo: { ...octo.operations.apollo, levelId: "octo" },
        zeus: { ...acme.operations.zeus, levelId: "acme" },
        hades: { ...acme.operations.hades, levelId: "acme" },
        // A closed room (#269): on the map of its level, never offered.
      },
      closedRooms: {
        vault: closedRoomOf({ ...acme.operations.vault, levelId: "acme" } as OperationSummary),
      },
    } as unknown as Parameters<typeof travelGroups>[1];
    const enterable = new Set(["apollo", "zeus", "vault"]);
    const here = compoundWorld(levelView(state, "octo"), enterable, "octo");
    const groups = travelGroups(here, state, "octo", enterable);
    // Hades is on Acme's level but this viewer may not enter it; the vault is closed.
    expect(groups.map((g) => [g.label?.title, g.here, g.rooms.map((r) => r.id)])).toEqual([
      ["Octo", true, ["landing", "apollo"]],
      ["Lobby level", false, ["lobby", "conference", "break_room"]],
      ["Acme", false, ["landing", "zeus"]],
    ]);
    expect(groups.map((g) => (g.label ? levelDepth(g.label) : null))).toEqual([
      "Sublevel 1",
      "",
      "Sublevel 2",
    ]);
    // From the lobby level: the lobby level's group first.
    const lobbyWorld = compoundWorld(levelView(state, "lobby"), enterable, "lobby");
    expect(
      travelGroups(lobbyWorld, state, "lobby", enterable).map((g) => g.level?.levelId),
    ).toEqual(["lobby", "octo", "acme"]);
    // A level this viewer cannot reach is not published, so it has no group.
    const { acme: _hidden, ...reachable } = (state as { levels: Record<string, LevelState> })
      .levels;
    expect(
      travelGroups(here, { ...state, levels: reachable } as typeof state, "octo", enterable).map(
        (g) => g.label?.title,
      ),
    ).toEqual(["Octo", "Lobby level"]);
  });

  test("an office that publishes no levels has one unnamed group", () => {
    const world = testWorld([{ id: "apollo", placement: rowPlacement(4) }]);
    const groups = travelGroups(world, null, "lobby", new Set(["apollo"]));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.level).toBeNull();
    expect(groups[0]?.rooms.map((r) => r.id)).toEqual([
      "lobby",
      "conference",
      "break_room",
      "apollo",
    ]);
    expect(travelGroups(null, null, "lobby", null)).toEqual([]);
  });

  test("clone badges: error wins over cloning; ready shows none", () => {
    const repo = (cloneStatus: "cloning" | "ready" | "error") => ({
      repoId: cloneStatus,
      owner: "o",
      name: "n",
      url: "https://github.com/o/n",
      defaultBranch: "main",
      isPrimary: false,
      cloneStatus,
      cloneError: null,
      hasCredential: false,
    });
    const operation = (...statuses: ("cloning" | "ready" | "error")[]): OperationInfo => ({
      operationId: "f",
      levelId: "lobby",
      name: "F",
      slug: "f",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "room",
      archivedAt: null,
      access: "view",
      repos: statuses.map(repo),
    });
    expect(cloneBadge(operation("ready", "cloning"))).toBe("cloning");
    expect(cloneBadge(operation("cloning", "error"))).toBe("error");
    expect(cloneBadge(operation("ready"))).toBeNull();
    expect(cloneBadge(undefined)).toBeNull();
    expect(anyCloning([operation("ready"), operation("cloning")])).toBe(true);
    expect(anyCloning(null)).toBe(false);
  });
});
