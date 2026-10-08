import { describe, expect, test } from "bun:test";
import { humansOn } from "./levels.ts";
import { findSeat, seatWorldOn } from "./seats.ts";
import { seatHolder } from "./social.ts";

const M = 2;
const fixed = (kind: string) => ({ kind, gridX: 26, gridY: 56, width: 12, depth: 8 });
const project = {
  gridX: 10,
  gridY: 10,
  width: 8,
  depth: 8,
  doorSide: "south",
  deskCount: 2,
  decorStyle: "ops_room",
  buildState: "ready",
  levelId: "lv-a",
};
const state = {
  compound: { tileMetres: M, specialRooms: [fixed("lobby")] },
  levels: new Map([
    ["lobby", { compound: { tileMetres: M, specialRooms: [fixed("lobby")] } }],
    ["lv-a", { compound: { tileMetres: M, specialRooms: [fixed("landing")] } }],
    ["lv-b", { compound: { tileMetres: M, specialRooms: [fixed("landing")] } }],
  ]),
  operations: new Map([["op-1", project]]),
};

describe("seats are per level (#269)", () => {
  test("a level's seats are its own fixed rooms' and its own project rooms'", () => {
    expect(findSeat(seatWorldOn(state, "lobby"), "lobby/sofa-1")).not.toBeNull();
    expect(findSeat(seatWorldOn(state, "lobby"), "landing/armchair-w")).toBeNull();
    expect(findSeat(seatWorldOn(state, "lv-a"), "landing/armchair-w")).not.toBeNull();
    expect(findSeat(seatWorldOn(state, "lv-a"), "lobby/sofa-1")).toBeNull();
    expect(findSeat(seatWorldOn(state, "lv-a"), "op-1/nook-chair-w-seat")?.project).toBe(true);
    expect(findSeat(seatWorldOn(state, "lv-b"), "op-1/nook-chair-w-seat")).toBeNull();
    // A level that is not published falls back to the lobby level's layout.
    expect(findSeat(seatWorldOn(state, "lv-gone"), "lobby/sofa-1")).not.toBeNull();
  });

  test("the same chair of two levels' landings is two seats", () => {
    const human = (levelId: string, seatId: string) => ({
      levelId,
      seatId,
      position: { x: 0, z: 0 },
    });
    const humans = new Map([
      ["a", human("lv-a", "landing/armchair-w")],
      ["b", human("lv-b", "")],
      ["c", human("lv-a", "")],
    ]);
    const on = (levelId: string) => humansOn(humans as never, levelId);
    expect(seatHolder(on("lv-a"), "landing/armchair-w", "c")).toBe("a");
    expect(seatHolder(on("lv-b"), "landing/armchair-w", "b")).toBeNull();
  });
});
