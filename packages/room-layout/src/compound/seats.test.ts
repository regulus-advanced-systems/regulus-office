import { describe, expect, test } from "bun:test";
import { SPECIAL_ROOM_KINDS } from "@regulus/protocol";
import { isHumanSeat, projectRoomLayout, projectRoomSeats, specialRoomSeats } from "./seats.ts";
import { BREAK_ROOM_TILES, CONFERENCE_TILES, LOBBY_TILES } from "./special.ts";

const SIZES = {
  lobby: LOBBY_TILES,
  conference: CONFERENCE_TILES,
  break_room: BREAK_ROOM_TILES,
  landing: LOBBY_TILES,
};

describe("specialRoomSeats", () => {
  test.each([...SPECIAL_ROOM_KINDS])(
    "%s: unique ids, inside the room, chairs and couches only",
    (kind) => {
      const { w, d } = SIZES[kind];
      const seats = specialRoomSeats(kind, w * 2, d * 2);
      expect(seats.length).toBeGreaterThan(0);
      expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length);
      for (const s of seats) {
        expect(isHumanSeat(s)).toBe(true);
        expect(s.pose.x).toBeGreaterThan(0);
        expect(s.pose.x).toBeLessThan(w * 2);
        expect(s.pose.z).toBeGreaterThan(0);
        expect(s.pose.z).toBeLessThan(d * 2);
      }
    },
  );

  test("the lobby has its sofa and two armchairs", () => {
    const ids = specialRoomSeats("lobby", 24, 16).map((s) => s.id);
    expect(ids).toEqual(["sofa-1", "sofa-2", "sofa-3", "armchair-w", "armchair-e"]);
  });
});

describe("projectRoomSeats", () => {
  const room = {
    width: 8,
    depth: 8,
    doorSide: "south",
    deskCount: 1,
    decorStyle: "ops_room",
  } as const;

  test("never offers a desk seat (henchmen sit there)", () => {
    const layout = projectRoomLayout(room);
    expect(layout?.seats.some((s) => s.kind === "desk")).toBe(true);
    const seats = projectRoomSeats(room);
    expect(seats.every((s) => s.kind !== "desk" && s.kind !== "reception")).toBe(true);
  });

  test("a room with a lounge nook offers its armchairs; a vanilla room has none", () => {
    expect(projectRoomSeats(room)).toEqual([]);
    expect(projectRoomSeats({ ...room, deskCount: 2 }).map((s) => s.id)).toEqual([
      "nook-chair-w-seat",
      "nook-chair-e-seat",
    ]);
  });

  test("clamps the desk count and caches per setting", () => {
    const a = projectRoomLayout({ ...room, deskCount: 99 });
    expect(a).not.toBeNull();
    expect(projectRoomLayout({ ...room, deskCount: 99 })).toBe(a);
    expect(projectRoomLayout({ ...room, deskCount: 0 })).toBe(projectRoomLayout(room));
  });
});
