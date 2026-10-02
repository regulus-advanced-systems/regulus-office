import { describe, expect, test } from "bun:test";
import {
  CHAT_BURST,
  CHAT_REFILL_MS,
  DEFAULT_GENIUS_LOOK,
  EMOTE_MIN_INTERVAL_MS,
  LOBBY_OPERATION_ID,
  SIT_REACH_METRES,
  seatKey,
} from "@regulus/protocol";
import { specialRoomSeats } from "@regulus/room-layout";
import type { RoomAuthUser } from "../auth.ts";
import { findSeat, type SeatWorld } from "./seats.ts";
import { createSocialRules, type SeatedHuman, seatHolder } from "./social.ts";

const M = 2;
const LOBBY = { kind: "lobby", gridX: 26, gridY: 56, width: 12, depth: 8 };
const BREAK = { kind: "break_room", gridX: 42, gridY: 56, width: 8, depth: 8 };
const project = {
  gridX: 10,
  gridY: 10,
  width: 8,
  depth: 8,
  doorSide: "south",
  deskCount: 2,
  decorStyle: "ops_room",
  buildState: "ready",
};
const world: SeatWorld = {
  compound: { tileMetres: M, specialRooms: [LOBBY, BREAK] },
  operations: new Map([["op-1", project]]),
};

const sofa = specialRoomSeats("lobby", 24, 16).find((s) => s.id === "sofa-2");
if (!sofa) throw new Error("no sofa seat");
const SOFA_KEY = seatKey(LOBBY_OPERATION_ID, "sofa-2");
const sofaAt = { x: LOBBY.gridX * M + sofa.pose.x, z: LOBBY.gridY * M + sofa.pose.z };

const user = (userId: string): RoomAuthUser => ({
  userId,
  displayName: userId,
  role: "member",
  avatar: DEFAULT_GENIUS_LOOK,
});

function humans(entries: Record<string, SeatedHuman>) {
  const map = new Map(Object.entries(entries));
  return { map, view: { forEach: (cb: (h: SeatedHuman, id: string) => void) => map.forEach(cb) } };
}

describe("findSeat", () => {
  test("finds special-room seats in compound metres", () => {
    const spot = findSeat(world, SOFA_KEY);
    expect(spot).toMatchObject({ roomId: LOBBY_OPERATION_ID, project: false, ...sofaAt });
    expect(findSeat(world, "break_room/stool-1w")?.seat.kind).toBe("chair");
  });

  test("finds a project room's lounge seat, never a desk seat", () => {
    expect(findSeat(world, "op-1/nook-chair-w-seat")?.project).toBe(true);
    expect(findSeat(world, "op-1/d1s1")).toBeNull();
  });

  test("unknown rooms, seats, unfinished rooms and malformed keys find nothing", () => {
    expect(findSeat(world, "conference/chair-n1")).toBeNull(); // not published here
    expect(findSeat(world, "lobby/sofa-9")).toBeNull();
    expect(findSeat(world, "couch-1")).toBeNull();
    const building = {
      ...world,
      operations: new Map([["op-1", { ...project, buildState: "building" }]]),
    };
    expect(findSeat(building, "op-1/nook-chair-w-seat")).toBeNull();
  });
});

describe("sit", () => {
  test("a seat taken first refuses the second human (claim race)", () => {
    const rules = createSocialRules();
    const near = { x: sofaAt.x, z: sofaAt.z - 1 };
    const { map, view } = humans({
      a: { seatId: "", position: near },
      b: { seatId: "", position: near },
    });
    // Both ask; the room applies one message at a time.
    const first = rules.checkSit(world, view, "a", user("u-a"), SOFA_KEY);
    expect(first.ok).toBe(true);
    (map.get("a") as SeatedHuman).seatId = SOFA_KEY;
    const second = rules.checkSit(world, view, "b", user("u-b"), SOFA_KEY);
    expect(second).toEqual({ ok: false, reason: "someone is already sitting there" });
    expect(seatHolder(view, SOFA_KEY, "b")).toBe("a");
    // Asking again for one's own seat is fine; once A stands up, B may sit.
    expect(rules.checkSit(world, view, "a", user("u-a"), SOFA_KEY).ok).toBe(true);
    (map.get("a") as SeatedHuman).seatId = "";
    expect(rules.checkSit(world, view, "b", user("u-b"), SOFA_KEY).ok).toBe(true);
  });

  test("too far away, no access or no such seat is refused", () => {
    const rules = createSocialRules({ canVisit: (u) => u.userId !== "u-out" });
    const { view } = humans({
      far: { seatId: "", position: { x: sofaAt.x + SIT_REACH_METRES + 0.1, z: sofaAt.z } },
      out: { seatId: "", position: { x: 10 * M + 3, z: 10 * M + 3 } },
    });
    expect(rules.checkSit(world, view, "far", user("u-far"), SOFA_KEY)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/too far/),
    });
    expect(rules.checkSit(world, view, "out", user("u-out"), "op-1/nook-chair-w-seat")).toEqual({
      ok: false,
      reason: "no access to operation op-1",
    });
    expect(rules.checkSit(world, view, "far", user("u-far"), "op-1/d1s1")).toEqual({
      ok: false,
      reason: "no seat op-1/d1s1",
    });
  });
});

describe("rate limits", () => {
  test("one emote per interval per client", () => {
    let t = 0;
    const rules = createSocialRules({ now: () => t });
    expect(rules.allowEmote("a")).toBe(true);
    expect(rules.allowEmote("a")).toBe(false);
    expect(rules.allowEmote("b")).toBe(true);
    t = EMOTE_MIN_INTERVAL_MS - 1;
    expect(rules.allowEmote("a")).toBe(false);
    t = EMOTE_MIN_INTERVAL_MS;
    expect(rules.allowEmote("a")).toBe(true);
  });

  test("chat allows a burst, then one line per refill", () => {
    let t = 0;
    const rules = createSocialRules({ now: () => t });
    for (let i = 0; i < CHAT_BURST; i++) expect(rules.allowChat("a")).toBe(true);
    expect(rules.allowChat("a")).toBe(false);
    t = CHAT_REFILL_MS;
    expect(rules.allowChat("a")).toBe(true);
    expect(rules.allowChat("a")).toBe(false);
    rules.forget("a");
    expect(rules.allowChat("a")).toBe(true);
  });
});
