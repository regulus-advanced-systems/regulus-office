import { afterEach, describe, expect, test } from "bun:test";
import { rowPlacement, testWorld } from "../scene/compound/testing.ts";
import { travelPose } from "../scene/compound/world.ts";
import { useCompoundStore, worldKey } from "./compound.ts";
import { usePlayerStore } from "./player.ts";
import { travelRoomIds, travelTo } from "./travel.ts";

const world = testWorld(
  [
    { id: "apollo", placement: rowPlacement(4) },
    { id: "zeus", placement: rowPlacement(16) },
  ],
  ["apollo"],
);

afterEach(() => {
  useCompoundStore.setState({ world: null });
  usePlayerStore.getState().reset();
});

describe("quick travel (#186)", () => {
  test("puts the player at the door of a room they may enter, and can walk them in", () => {
    useCompoundStore.setState({ world });
    usePlayerStore.getState().spawnAt({ x: 1, z: 1, heading: 0 }, "compound");
    expect(travelRoomIds()).toEqual(["lobby", "conference", "break_room", "apollo"]);
    const apollo = world.rooms.find((r) => r.id === "apollo");
    if (!apollo) throw new Error("no room");
    expect(travelTo("apollo")).toBe(true);
    const p = usePlayerStore.getState();
    expect({ x: p.x, z: p.z, heading: p.heading }).toEqual(travelPose(apollo));
    expect(p.spawnKey).toBe("compound");
    expect(travelTo("apollo", { walkIn: true })).toBe(true);
    const target = usePlayerStore.getState().target;
    expect(target?.z).toBeLessThan(apollo.origin.z + apollo.size.d);
    expect(target?.z).toBeGreaterThan(apollo.origin.z);
  });

  test("not to rooms the player may not enter, nor before spawning", () => {
    useCompoundStore.setState({ world });
    expect(travelTo("apollo")).toBe(false);
    usePlayerStore.getState().spawnAt({ x: 1, z: 1, heading: 0 }, "compound");
    expect(travelTo("zeus")).toBe(false);
    expect(travelTo("nowhere")).toBe(false);
  });

  test("the published world only changes when something drawn does", () => {
    const counted = {
      ...world,
      rooms: world.rooms.map((r) => (r.id === "apollo" ? { ...r, henchmenWorking: 2 } : r)),
    };
    expect(worldKey(counted)).not.toBe(worldKey(world));
    expect(worldKey({ ...world })).toBe(worldKey(world));
  });
});
