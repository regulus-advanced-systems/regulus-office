/**
 * The room's bookkeeping for "come back where you left" (#262): when a place
 * is written, when it is forgotten, and that a refused one leaves the person
 * at the lobby spawn.
 */
import { expect, test } from "bun:test";
import { HumanPresenceSchema, LOBBY_LEVEL_ID, LOBBY_OPERATION_ID } from "@regulus/protocol";
import { createLogger } from "../../logging.ts";
import type { LairView } from "../../operations/access.ts";
import { ACME, APOLLO, lairState } from "../../pm/world/test-lair.ts";
import { MemoryPlaceStore, type PlaceStore } from "./place-store.ts";
import type { ReturnPlace } from "./return-place.ts";
import { createReturning, PLACE_SAVE_EVERY_MS } from "./returning.ts";
import { lobbySpawnPose } from "./spawn.ts";

const logger = createLogger({ level: "silent" });
const IN_APOLLO: ReturnPlace = { levelId: ACME, operationId: APOLLO, x: 24, z: 68, heading: 1 };
const MAY: LairView = {
  rooms: new Map([[APOLLO, "spawn"]]),
  levels: new Set([LOBBY_LEVEL_ID, ACME]),
  linked: true,
};
const MAY_NOT: LairView = { rooms: new Map(), levels: new Set([LOBBY_LEVEL_ID]), linked: true };

function human(userId = "u-ante") {
  const h = new HumanPresenceSchema();
  h.sessionId = `s-${userId}`;
  h.userId = userId;
  return h;
}

const placeOf = (h: ReturnType<typeof human>) => ({
  levelId: h.levelId,
  operationId: h.operationId,
  x: h.position.x,
  z: h.position.z,
  heading: h.position.heading,
});

test("nobody remembered: the lobby spawn, and nothing is written for standing there", () => {
  const places = new MemoryPlaceStore();
  const returning = createReturning({ places, logger });
  const state = lairState();
  const h = human();
  expect(returning.arrive(state, h.sessionId, h, MAY)).toBe(false);
  expect(placeOf(h)).toEqual({
    levelId: LOBBY_LEVEL_ID,
    operationId: LOBBY_OPERATION_ID,
    ...(lobbySpawnPose(state.compound) as NonNullable<ReturnType<typeof lobbySpawnPose>>),
  });
  state.humans.set(h.sessionId, h);
  returning.tick(state, 60_000);
  returning.leave(h.sessionId, h);
  expect(places.places.size).toBe(0);
});

test("a remembered place the gate allows is taken up and kept", () => {
  const places = new MemoryPlaceStore();
  places.save("u-ante", IN_APOLLO);
  const returning = createReturning({ places, logger });
  const h = human();
  expect(returning.arrive(lairState(), h.sessionId, h, MAY)).toBe(true);
  expect(placeOf(h)).toEqual(IN_APOLLO);
  expect(places.load("u-ante")).toEqual(IN_APOLLO);
});

test("a remembered place the gate refuses: the lobby spawn, and it is forgotten", () => {
  const places = new MemoryPlaceStore();
  places.save("u-ante", IN_APOLLO);
  const returning = createReturning({ places, logger });
  const state = lairState();
  const h = human();
  expect(returning.arrive(state, h.sessionId, h, MAY_NOT)).toBe(false);
  expect(h.levelId).toBe(LOBBY_LEVEL_ID);
  expect(h.operationId).toBe(LOBBY_OPERATION_ID);
  expect(h.position.x).toBe(lobbySpawnPose(state.compound)?.x ?? Number.NaN);
  expect(places.load("u-ante")).toBeNull();
});

test("before the lair is published the place is kept for when it is", () => {
  const places = new MemoryPlaceStore();
  places.save("u-ante", IN_APOLLO);
  const returning = createReturning({ places, logger });
  const unpublished = lairState();
  unpublished.levels.clear();
  unpublished.compound.width = 0;
  const h = human();
  expect(returning.arrive(unpublished, h.sessionId, h, MAY)).toBe(false);
  expect(places.load("u-ante")).toEqual(IN_APOLLO);
  // The lair is published: the same person, who has not moved, is put where they left.
  expect(returning.arrive(lairState(), h.sessionId, h, MAY)).toBe(true);
  expect(placeOf(h)).toEqual(IN_APOLLO);
});

test("a walking person's place is written every few seconds, and at once when they leave", () => {
  const places = new MemoryPlaceStore();
  const returning = createReturning({ places, logger });
  const state = lairState();
  const h = human();
  returning.arrive(state, h.sessionId, h, MAY);
  state.humans.set(h.sessionId, h);
  returning.tick(state, 100_000);
  expect(places.load("u-ante")).toBeNull();

  h.position.x += 3;
  returning.tick(state, 100_000 + PLACE_SAVE_EVERY_MS - 1);
  expect(places.load("u-ante")).toBeNull();
  returning.tick(state, 100_000 + PLACE_SAVE_EVERY_MS);
  expect(places.load("u-ante")).toEqual(placeOf(h));

  h.position.z -= 1;
  h.position.heading = 2;
  returning.leave(h.sessionId, h);
  expect(places.load("u-ante")).toEqual(placeOf(h));
});

test("without a store nobody is remembered and nothing breaks", () => {
  const returning = createReturning({ logger });
  const state = lairState();
  const h = human();
  expect(returning.arrive(state, h.sessionId, h, MAY)).toBe(false);
  state.humans.set(h.sessionId, h);
  h.position.x += 3;
  returning.tick(state, 1e9);
  returning.leave(h.sessionId, h);
});

test("a store that fails does not take the room down, and is not hammered", () => {
  let saves = 0;
  const broken: PlaceStore = {
    load: () => {
      throw new Error("no database");
    },
    save: () => {
      saves += 1;
      throw new Error("no database");
    },
    clear: () => {
      throw new Error("no database");
    },
  };
  const returning = createReturning({ places: broken, logger });
  const state = lairState();
  const h = human();
  expect(returning.arrive(state, h.sessionId, h, MAY)).toBe(false);
  state.humans.set(h.sessionId, h);
  for (let i = 1; i <= 3; i++) {
    h.position.x += 1;
    returning.tick(state, i * PLACE_SAVE_EVERY_MS * 2);
  }
  expect(saves).toBe(1);
});
