import { describe, expect, test } from "bun:test";
import { EMOTES } from "./enums.ts";
import { EMOTE_LABELS, parseSeatKey, seatKey } from "./social.ts";

describe("seat keys", () => {
  test("round-trip a room id and a seat id", () => {
    expect(seatKey("lobby", "couch-1")).toBe("lobby/couch-1");
    expect(parseSeatKey("lobby/couch-1")).toEqual({ roomId: "lobby", seatId: "couch-1" });
    expect(parseSeatKey(seatKey("op-7", "nook-chair-w-seat"))).toEqual({
      roomId: "op-7",
      seatId: "nook-chair-w-seat",
    });
  });

  test("reject keys without both parts", () => {
    for (const bad of ["", "couch-1", "/couch-1", "lobby/"]) expect(parseSeatKey(bad)).toBeNull();
  });
});

test("every emote has a label and an icon", () => {
  for (const emote of EMOTES) {
    expect(EMOTE_LABELS[emote].label.length).toBeGreaterThan(0);
    expect(EMOTE_LABELS[emote].icon.length).toBeGreaterThan(0);
  }
});
