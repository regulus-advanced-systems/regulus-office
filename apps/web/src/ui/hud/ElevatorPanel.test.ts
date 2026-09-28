import { describe, expect, test } from "bun:test";
import type { FloorInfo, FloorSummary } from "@regulus/protocol";
import { anyCloning, cloneBadge } from "../../state/floors.ts";
import { visibleFloors } from "./ElevatorPanel.tsx";

const summary = (floorId: string, index: number): FloorSummary => ({
  floorId,
  name: floorId,
  slug: floorId,
  index,
  paletteId: "teal-cream",
  robotsWorking: 0,
  robotsWaiting: 0,
  robotsTotal: 0,
  humansPresent: 0,
});

const directory = {
  f2: summary("f2", 2),
  lobby: summary("lobby", 0),
  f1: summary("f1", 1),
};

describe("elevator floors", () => {
  test("lobby always; project floors only when accessible; elevator order", () => {
    expect(visibleFloors(directory, null).map((f) => f.floorId)).toEqual(["lobby", "f1", "f2"]);
    expect(visibleFloors(directory, new Set(["f2"])).map((f) => f.floorId)).toEqual([
      "lobby",
      "f2",
    ]);
    expect(visibleFloors(null, new Set())).toEqual([]);
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
    const floor = (...statuses: ("cloning" | "ready" | "error")[]): FloorInfo => ({
      floorId: "f",
      name: "F",
      slug: "f",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "office-l2",
      archivedAt: null,
      access: "view",
      repos: statuses.map(repo),
    });
    expect(cloneBadge(floor("ready", "cloning"))).toBe("cloning");
    expect(cloneBadge(floor("cloning", "error"))).toBe("error");
    expect(cloneBadge(floor("ready"))).toBeNull();
    expect(cloneBadge(undefined)).toBeNull();
    expect(anyCloning([floor("ready"), floor("cloning")])).toBe(true);
    expect(anyCloning(null)).toBe(false);
  });
});
