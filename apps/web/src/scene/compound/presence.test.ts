import { describe, expect, test } from "bun:test";
import { createPresenceMemory, LINGER_MS, pickRooms, samePick } from "./presence.ts";
import { rowPlacement, testWorld } from "./testing.ts";

const world = testWorld(
  [
    { id: "a", placement: rowPlacement(2) },
    { id: "b", placement: rowPlacement(12) },
    { id: "c", placement: rowPlacement(22) },
    { id: "d", placement: rowPlacement(32) },
    { id: "locked", placement: rowPlacement(40, 6, 6) },
  ],
  ["a", "b", "c", "d"],
);
const centre = (id: string) => {
  const r = world.rooms.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return { x: r.origin.x + r.size.w / 2, z: r.origin.z + r.size.d / 2 };
};
const all = new Set(world.rooms.map((r) => r.id));

describe("which FloorRooms to be in (#186, SPEC §9.1)", () => {
  test("the room the player stands in, plus the three nearest visible rooms", () => {
    const pick = pickRooms(world, centre("a"), all, createPresenceMemory(), 0);
    expect(pick.current).toBe("a");
    expect(pick.nearby).toEqual(["b", "c", "d"]);
  });

  test("never a room the viewer may not see into; none in the lobby or corridors", () => {
    const lobby = world.rooms.find((r) => r.kind === "lobby");
    if (!lobby) throw new Error("no lobby");
    const pick = pickRooms(
      world,
      { x: lobby.origin.x + 2, z: lobby.origin.z + 2 },
      all,
      createPresenceMemory(),
      0,
    );
    expect(pick.current).toBeNull();
    expect(pick.nearby).not.toContain("locked");
    expect(pick.nearby).toHaveLength(3);
  });

  test("only rooms on screen are joined, nearest first", () => {
    const pick = pickRooms(world, centre("a"), new Set(["d", "c"]), createPresenceMemory(), 0);
    expect(pick.nearby).toEqual(["c", "d"]);
  });

  test("a room that leaves the view lingers a few seconds before it is left", () => {
    const memory = createPresenceMemory();
    pickRooms(world, centre("a"), new Set(["b"]), memory, 0);
    const soon = pickRooms(world, centre("a"), new Set(["c"]), memory, LINGER_MS / 2);
    expect(soon.nearby).toEqual(["c", "b"]);
    const later = pickRooms(world, centre("a"), new Set(["c"]), memory, LINGER_MS + 1);
    expect(later.nearby).toEqual(["c"]);
    expect(samePick(soon, later)).toBe(false);
    expect(samePick(later, { current: "a", nearby: ["c"] })).toBe(true);
  });
});
