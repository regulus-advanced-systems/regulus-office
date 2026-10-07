import { describe, expect, test } from "bun:test";
import type { CompoundState, LevelState, OperationInfo } from "@regulus/protocol";
import { rowPlacement, testState, testWorld } from "../../scene/compound/testing.ts";
import { compoundWorld } from "../../scene/compound/world.ts";
import { levelView } from "../../state/level.ts";
import { anyCloning, cloneBadge } from "../../state/operations.ts";
import { levelKindLabel, levelRooms, travelRooms } from "./QuickTravel.tsx";

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

  test("rooms are grouped by level: this level's first, then the other levels' (#268)", () => {
    const spot = rowPlacement(4);
    const octo = testState([{ id: "apollo", placement: spot }]);
    const acme = testState([
      { id: "zeus", placement: spot },
      { id: "hades", placement: rowPlacement(16) },
    ]);
    const lobby = testState([]);
    const level = (levelId: string, name: string, order: number, compound: CompoundState) =>
      ({ levelId, kind: "org", login: name, name, order, compound }) as LevelState;
    const state = {
      compound: lobby.compound,
      levels: {
        acme: level("acme", "Acme", 2, acme.compound),
        octo: level("octo", "Octo", 1, octo.compound),
        lobby: level("lobby", "Lobby", 0, lobby.compound),
      },
      operations: {
        ...lobby.operations,
        apollo: { ...octo.operations.apollo, levelId: "octo" },
        zeus: { ...acme.operations.zeus, levelId: "acme" },
        hades: { ...acme.operations.hades, levelId: "acme" },
      },
    } as unknown as Parameters<typeof levelRooms>[1];
    const here = compoundWorld(levelView(state, "octo"), new Set(["apollo"]));
    const listed = levelRooms(here?.rooms ?? [], state, "octo", new Set(["apollo", "zeus"]));
    // Hades is on Acme's level but this viewer may not enter it: not listed.
    expect(listed.map((r) => [r.room.id, r.level?.name ?? null])).toEqual([
      ["lobby", null],
      ["conference", null],
      ["break_room", null],
      ["apollo", null],
      ["zeus", "Acme"],
    ]);
    // From the lobby level every project room is on another level.
    const lobbyWorld = compoundWorld(levelView(state, "lobby"), null);
    expect(
      levelRooms(lobbyWorld?.rooms ?? [], state, "lobby", new Set(["apollo", "zeus"]))
        .filter((r) => r.level)
        .map((r) => [r.room.id, r.level?.name]),
    ).toEqual([
      ["apollo", "Octo"],
      ["zeus", "Acme"],
    ]);
  });

  test("the level list says what each level is (#268)", () => {
    expect(
      (["lobby", "org", "account", "holding"] as const).map((kind) => levelKindLabel(kind)),
    ).toEqual(["shared level", "organisation", "account", "rooms without a repo owner"]);
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
