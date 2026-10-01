import { describe, expect, test } from "bun:test";
import { checkPlacement, defaultCompoundSpec } from "@regulus/floor-layout";
import { LOBBY_FLOOR_ID } from "@regulus/protocol";
import { rowPlacement, testState, testWorld } from "./testing.ts";
import {
  compoundWorld,
  currentFloorAt,
  distanceToRoom,
  isOpenRoom,
  lobbyOf,
  roomAt,
  travelPose,
} from "./world.ts";

describe("compoundWorld", () => {
  test("nothing until the layout is published", () => {
    expect(compoundWorld(null, null)).toBeNull();
  });

  test("special rooms and placed project rooms, in metres, with access", () => {
    const spec = defaultCompoundSpec(48);
    const placed = [4, 16, 28].map((x, i) => ({ id: `r${i}`, placement: rowPlacement(x) }));
    for (const p of placed) expect(checkPlacement(spec, placed, p.id, p.placement).ok).toBe(true);
    const world = testWorld(
      [
        { id: "apollo", placement: rowPlacement(4), deskCount: 2, decorStyle: "lab" },
        { id: "hermes", placement: rowPlacement(16), building: true },
        { id: "zeus", placement: rowPlacement(28) },
      ],
      ["apollo", "hermes"],
    );
    expect(world.rooms.map((r) => r.id)).toEqual([
      LOBBY_FLOOR_ID,
      "conference",
      "break_room",
      "apollo",
      "hermes",
      "zeus",
    ]);
    const apollo = world.rooms.find((r) => r.id === "apollo");
    expect(apollo).toMatchObject({
      kind: "project",
      origin: { x: 8, z: 56 },
      size: { w: 16, d: 16 },
      deskCount: 2,
      decorStyle: "lab",
      enterable: true,
    });
    expect(world.rooms.map((r) => [r.id, isOpenRoom(r)])).toEqual([
      [LOBBY_FLOOR_ID, true],
      ["conference", true],
      ["break_room", true],
      ["apollo", true],
      ["hermes", false], // still building
      ["zeus", false], // no access
    ]);
    expect(world.corridors.length).toBeGreaterThan(0);
  });

  test("the REST list still loading: only the special rooms are open", () => {
    const world = compoundWorld(testState([{ id: "apollo", placement: rowPlacement(4) }]), null);
    expect(world?.rooms.find((r) => r.id === "apollo")?.enterable).toBe(false);
    expect(world?.rooms.find((r) => r.id === LOBBY_FLOOR_ID)?.enterable).toBe(true);
  });
});

describe("where the player is", () => {
  const world = testWorld([{ id: "apollo", placement: rowPlacement(4) }]);
  const apollo = world.rooms.find((r) => r.id === "apollo");
  if (!apollo) throw new Error("no room");

  test("rooms by point; only project rooms are FloorRooms", () => {
    expect(roomAt(world, apollo.origin.x + 1, apollo.origin.z + 1)?.id).toBe("apollo");
    expect(currentFloorAt(world, apollo.origin.x + 1, apollo.origin.z + 1)).toBe("apollo");
    const lobby = lobbyOf(world);
    if (!lobby) throw new Error("no lobby");
    expect(currentFloorAt(world, lobby.origin.x + 2, lobby.origin.z + 2)).toBeNull();
    expect(roomAt(world, 1, 1)).toBeNull();
  });

  test("distance to a room's footprint", () => {
    expect(distanceToRoom(apollo, apollo.origin.x + 3, apollo.origin.z + 3)).toBe(0);
    expect(distanceToRoom(apollo, apollo.origin.x - 3, apollo.origin.z - 4)).toBe(5);
  });

  test("quick travel stands in the corridor in front of the door, facing in", () => {
    const pose = travelPose(apollo);
    expect(pose.z).toBeGreaterThan(apollo.origin.z + apollo.size.d);
    expect(pose.x).toBeCloseTo(apollo.origin.x + apollo.size.w / 2, 5);
    expect(pose.heading).toBe(0); // north, into the room
  });
});
