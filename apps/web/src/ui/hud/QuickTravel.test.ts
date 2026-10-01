import { describe, expect, test } from "bun:test";
import type { OperationInfo } from "@regulus/protocol";
import { rowPlacement, testWorld } from "../../scene/compound/testing.ts";
import { anyCloning, cloneBadge } from "../../state/operations.ts";
import { travelRooms } from "./QuickTravel.tsx";

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
