import { describe, expect, test } from "bun:test";
import type { HumanPresence } from "@regulus/protocol";
import { humanFixture } from "@regulus/protocol/src/fixtures.ts";
import { rowPlacement, testWorld } from "../../scene/compound/testing.ts";
import type { WorldRoom } from "../../scene/compound/world.ts";
import { BUILD_MODE_OVERLAY } from "../build-mode/store.ts";
import { doingFor } from "./useDoingSync.ts";
import { doingLine, placeAt, rowsKey, whereaboutsRows } from "./whereabouts.ts";

const world = testWorld(
  [
    { id: "apollo", name: "Apollo", placement: rowPlacement(4) },
    { id: "zeus", name: "Zeus", placement: rowPlacement(28, 10, 8) },
  ],
  ["apollo"],
);
const room = (id: string) => world.rooms.find((r) => r.id === id) as WorldRoom;
const mid = (r: WorldRoom) => ({ x: r.origin.x + r.size.w / 2, z: r.origin.z + r.size.d / 2 });
const corridor = world.corridors[0];
if (!corridor) throw new Error("no corridor");
const inCorridor = {
  x: (corridor.x + corridor.w / 2) * world.tileMetres,
  z: (corridor.y + corridor.d / 2) * world.tileMetres,
};

function human(
  sessionId: string,
  name: string,
  at: { x: number; z: number },
  extra: Partial<HumanPresence> = {},
): HumanPresence {
  return {
    ...structuredClone(humanFixture),
    sessionId,
    userId: `u-${name}`,
    displayName: name,
    position: { x: at.x, z: at.z, heading: 0 },
    doing: "",
    seatId: "",
    ...extra,
  };
}

describe("places (#49)", () => {
  test("rooms by name (shut ones too), the corridors, the beach", () => {
    expect(placeAt(world, mid(room("lobby")).x, mid(room("lobby")).z)).toEqual({
      label: "Lobby",
      zone: "room",
      roomId: "lobby",
    });
    expect(placeAt(world, mid(room("break_room")).x, mid(room("break_room")).z).label).toBe(
      "Break room",
    );
    expect(placeAt(world, mid(room("zeus")).x, mid(room("zeus")).z).label).toBe("Zeus");
    expect(placeAt(world, inCorridor.x, inCorridor.z).zone).toBe("corridor");
    expect(placeAt(world, 40, world.depth * world.tileMetres + 3)).toMatchObject({
      label: "On the beach",
      zone: "outside",
    });
    expect(placeAt(null, 0, 0).zone).toBe("unknown");
  });
});

describe("rows", () => {
  const lobby = mid(room("lobby"));
  const state = {
    humans: {
      s1: human("s1", "Zed", mid(room("apollo")), { doing: "at the issue board" }),
      s2: human("s2", "Ada", lobby, { seatId: "lobby/sofa-1", joinedAt: 1 }),
      // Ada in a second tab, newer: listed once, as the newer session.
      s3: human("s3", "Ada", inCorridor, { joinedAt: 2 }),
      me: human("me", "Moe", lobby),
    },
  };

  test("me first, then by name; one row per human; place and doing", () => {
    const rows = whereaboutsRows(state, world, "me");
    expect(rows.map((r) => [r.name, r.self, r.place.label, r.doing])).toEqual([
      ["Moe", true, "Lobby", ""],
      ["Ada", false, "In a corridor", ""],
      ["Zed", false, "Apollo", "at the issue board"],
    ]);
    expect(rows[1]?.sessionId).toBe("s3");
  });

  test("the key ignores steps inside one place, not a change of place", () => {
    const before = rowsKey(whereaboutsRows(state, world, "me"));
    const stepped = structuredClone(state);
    stepped.humans.me.position.x += 0.5;
    expect(rowsKey(whereaboutsRows(stepped, world, "me"))).toBe(before);
    stepped.humans.s1.position = { ...inCorridor, heading: 0 };
    expect(rowsKey(whereaboutsRows(stepped, world, "me"))).not.toBe(before);
  });

  test("doing: the status, else sitting", () => {
    expect(doingLine({ doing: "", seatId: "lobby/sofa-1" })).toBe("sitting down");
    expect(doingLine({ doing: "at the PR board", seatId: "lobby/sofa-1" })).toBe("at the PR board");
    expect(doingLine({ doing: "", seatId: "" })).toBe("");
  });
});

describe("what the player is doing", () => {
  const none = { terminal: false, changes: false, board: null, queue: false, overlay: null };
  test("the most specific open panel wins; nothing open says nothing", () => {
    expect(doingFor(none)).toBe("");
    expect(doingFor({ ...none, board: "issue", terminal: true })).toBe(
      "watching a henchman's terminal",
    );
    expect(doingFor({ ...none, board: "pr" })).toBe("at the PR board");
    expect(doingFor({ ...none, queue: true })).toBe("at the task queue");
    expect(doingFor({ ...none, overlay: BUILD_MODE_OVERLAY })).toBe("building a room");
    expect(doingFor({ ...none, overlay: "help" })).toBe("");
  });
});
