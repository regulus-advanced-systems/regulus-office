import { describe, expect, test } from "bun:test";
import {
  checkPlacement,
  defaultCompoundSpec,
  landingSpec,
  mainCorridor,
} from "@regulus/room-layout";
import { closedRoomOf, rowPlacement, testState, testWorld } from "../../scene/compound/testing.ts";
import { arrivalRoomOf, compoundWorld, lobbyOf } from "../../scene/compound/world.ts";
import {
  arrowStep,
  buildFrame,
  clampSide,
  describeRefusal,
  ghostAt,
  localCheck,
  newCorridorTiles,
  placedRooms,
  placementOf,
  presetOf,
  rotateDoor,
  SIZE_PRESETS,
  specOf,
  suggestSpot,
} from "./logic.ts";

const world = testWorld([{ id: "apollo", name: "Apollo", placement: rowPlacement(4) }]);

describe("build mode rules", () => {
  test("sizes: presets, custom sizes, and sides kept to 4..12 tiles", () => {
    expect(presetOf({ w: 6, d: 6 })).toBe("S");
    expect(presetOf(SIZE_PRESETS.L)).toBe("L");
    expect(presetOf({ w: 5, d: 9 })).toBe("custom");
    expect([clampSide(2), clampSide(7.4), clampSide(40), clampSide(Number.NaN)]).toEqual([
      4, 7, 12, 4,
    ]);
  });

  test("the ghost's middle sits under the cursor, snapped to tiles and kept on the grid", () => {
    expect(ghostAt(world, { x: 41, z: 21 }, { w: 8, d: 8 })).toEqual({ x: 17, y: 7 });
    expect(ghostAt(world, { x: 41, z: 21 }, { w: 5, d: 5 })).toEqual({ x: 18, y: 8 });
    expect(ghostAt(world, { x: -30, z: 9999 }, { w: 8, d: 8 })).toEqual({
      x: 0,
      y: world.depth - 8,
    });
  });

  test("arrows step one tile along the grid, relative to the camera", () => {
    // Yaw 0: the camera looks north, so up is north and right is east.
    expect(arrowStep("ArrowUp", 0)).toEqual({ x: 0, y: -1 });
    expect(arrowStep("ArrowRight", 0)).toEqual({ x: 1, y: 0 });
    expect(arrowStep("ArrowDown", 0)).toEqual({ x: 0, y: 1 });
    expect(arrowStep("ArrowLeft", 0)).toEqual({ x: -1, y: 0 });
    // Turned 90°: up is now west.
    expect(arrowStep("ArrowUp", Math.PI / 2)).toEqual({ x: -1, y: 0 });
    // At 45° every key still picks a grid direction, and the four are distinct.
    for (const yaw of [Math.PI / 4, -Math.PI / 4, 3.1]) {
      const steps = (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"] as const).map((k) =>
        arrowStep(k, yaw),
      );
      expect(new Set(steps.map((s) => `${s.x},${s.y}`)).size).toBe(4);
      for (const s of steps) expect(Math.abs(s.x) + Math.abs(s.y)).toBe(1);
    }
  });

  test("R turns the door clockwise, Shift+R back", () => {
    expect(rotateDoor("north")).toBe("east");
    expect(rotateDoor("west")).toBe("north");
    expect(rotateDoor("north", -1)).toBe("west");
    let side = rotateDoor("south");
    for (let i = 0; i < 3; i++) side = rotateDoor(side);
    expect(side).toBe("south");
  });

  test("the local check matches the server's rules and previews the new corridor", () => {
    const spec = specOf(world);
    expect(spec).toEqual(defaultCompoundSpec(48));
    const lobby = lobbyOf(world);
    if (!lobby || !spec) throw new Error("no lobby");
    const onLobby = placementOf(lobby.rect, { w: 8, d: 8 }, "south");
    expect(localCheck(world, onLobby)).toMatchObject({
      ok: false,
      reason: "overlap",
      conflicts: ["lobby"],
      corridor: [],
    });
    // On Apollo, unless it is Apollo being moved.
    const onApollo = rowPlacement(4);
    expect(localCheck(world, onApollo).reason).toBe("overlap");
    expect(localCheck(world, onApollo, "apollo").ok).toBe(true);
    // Far north, door south: valid, and a corridor has to be laid to it.
    const far = { gridX: 30, gridY: 4, width: 6, depth: 6, doorSide: "south" as const };
    const result = localCheck(world, far);
    expect(result.ok).toBe(checkPlacement(spec, [], "x", far).ok);
    expect(result.ok).toBe(true);
    const tiles = result.corridor.reduce((n, r) => n + r.w * r.d, 0);
    expect(tiles).toBeGreaterThan(20);
    // The preview never covers corridor that is already there.
    const main = mainCorridor(spec);
    for (const r of result.corridor)
      expect(r.y + r.d <= main.y || r.y >= main.y + main.d).toBe(true);
  });

  test("a level other than the lobby level has its own rules: only the lift landing is fixed (#269)", () => {
    const level = testState([{ id: "apollo", placement: rowPlacement(4) }], 48, {
      levelId: "lv-a",
      landing: true,
    });
    const below = compoundWorld(level, new Set(["apollo"]), "lv-a");
    if (!below) throw new Error("no world");
    expect(specOf(below)).toEqual(landingSpec(defaultCompoundSpec(48)));
    const landing = arrivalRoomOf(below);
    if (!landing) throw new Error("no landing");
    const onLanding = placementOf(landing.rect, { w: 8, d: 8 }, "south");
    expect(localCheck(below, onLanding)).toMatchObject({ ok: false, conflicts: ["landing"] });
    expect(describeRefusal(below, "overlap", ["landing"])).toBe("It overlaps the lift landing.");
    expect(describeRefusal(below, "unreachable", [])).toBe(
      "No corridor can reach that door from the lift landing.",
    );
    expect(describeRefusal(world, "unreachable", [])).toBe(
      "No corridor can reach that door from the lobby.",
    );
    // Where the lobby level has its war room, this level has free rock to build in.
    const war = world.rooms.find((r) => r.kind === "conference");
    if (!war) throw new Error("no war room");
    const there = placementOf(war.rect, { w: 8, d: 8 }, "north");
    expect(localCheck(world, there).ok).toBe(false);
    expect(localCheck(below, there).ok).toBe(true);
    expect(suggestSpot(below, { w: 8, d: 8 })).not.toBeNull();
  });

  test("a closed room's spot is taken, and all the ghost says is that it is a closed room (#269)", () => {
    const level = testState(
      [
        { id: "apollo", name: "Apollo", placement: rowPlacement(4) },
        { id: "vault", name: "Top secret", placement: rowPlacement(16) },
      ],
      48,
      { levelId: "lv-a", landing: true },
    );
    const { vault, ...operations } = level.operations;
    if (!vault) throw new Error("no vault");
    const below = compoundWorld(
      { compound: level.compound, operations, closedRooms: [closedRoomOf(vault)] },
      new Set(["apollo"]),
      "lv-a",
    );
    if (!below) throw new Error("no world");
    expect(placedRooms(below).map((r) => r.id)).toEqual(["apollo", "vault"]);
    const onVault = rowPlacement(16);
    const check = localCheck(below, onVault);
    expect(check).toMatchObject({ ok: false, reason: "overlap", conflicts: ["vault"] });
    expect(describeRefusal(below, check.reason, check.conflicts)).toBe(
      "It overlaps a closed room.",
    );
    // Right beside it is too close, as beside any room.
    expect(localCheck(below, rowPlacement(25)).reason).toBe("too_close");
    expect(suggestSpot(below, { w: 8, d: 8 })).not.toBeNull();
  });

  test("new corridor tiles are those of the next network not in the current one", () => {
    const current = [{ x: 0, y: 0, w: 4, d: 2 }];
    const next = [
      { x: 0, y: 0, w: 4, d: 2 },
      { x: 2, y: 2, w: 2, d: 4 },
    ];
    expect(newCorridorTiles(8, 8, current, next)).toEqual([{ x: 2, y: 2, w: 2, d: 4 }]);
  });

  test("the first spot offered is a valid one", () => {
    const spot = suggestSpot(world, { w: 8, d: 8 });
    if (!spot) throw new Error("no spot");
    expect(localCheck(world, placementOf(spot, { w: 8, d: 8 }, "south")).ok).toBe(true);
  });

  test("refusals in words, naming the rooms in the way", () => {
    expect(describeRefusal(world, "overlap", ["lobby", "apollo"])).toBe(
      "It overlaps the lobby and Apollo.",
    );
    expect(describeRefusal(world, "too_close", ["main_corridor"])).toBe(
      "Too close to the main corridor: keep 2 tiles clear for a corridor.",
    );
    expect(describeRefusal(world, "door_blocked", [])).toContain("Turn it (R)");
    expect(describeRefusal(world, "unreachable", [])).toBe(
      "No corridor can reach that door from the lobby.",
    );
    expect(describeRefusal(world, "blocks_room", ["apollo"])).toBe(
      "It would cut Apollo off from the lobby.",
    );
  });

  test("while placing, the camera frames the built compound with room around it", () => {
    const f = buildFrame(world);
    expect(f.extent).toBeLessThanOrEqual(world.width * world.tileMetres);
    expect(f.extent).toBeGreaterThan(30);
  });
});
