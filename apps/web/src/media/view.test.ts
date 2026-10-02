import { describe, expect, test } from "bun:test";
import { type BuildingState, LOBBY_OPERATION_ID } from "@regulus/protocol";
import { humanFixture } from "@regulus/protocol/src/fixtures.ts";
import type { TvSpot } from "../scene/tv/spot.ts";
import { mediaView } from "./view.ts";

const world = {
  rooms: [
    { id: LOBBY_OPERATION_ID, kind: "lobby", origin: { x: 0, z: 0 }, size: { w: 24, d: 16 } },
    { id: "op-1", kind: "project", origin: { x: 0, z: -30 }, size: { w: 10, d: 10 } },
  ],
} as never;

const tv: TvSpot = {
  x: 18,
  z: 8,
  w: 2.4,
  d: 0.6,
  heading: Math.PI,
  screen: { w: 2, h: 1.12, y: 1.36 },
  stand: { x: 18, z: 9.1 },
  roomId: LOBBY_OPERATION_ID,
};

const humans = (entries: Array<[string, number, number, Partial<typeof humanFixture>?]>) =>
  ({
    humans: Object.fromEntries(
      entries.map(([id, x, z, extra]) => [
        id,
        { ...humanFixture, sessionId: id, position: { x, z, heading: 0 }, ...extra },
      ]),
    ),
  }) as Pick<BuildingState, "humans">;

const settings = { volume: 0.8, voiceVolume: 0.5, pushToTalk: true };

describe("media view (#48)", () => {
  test("we stand where the player is; everyone else where the office says", () => {
    const v = mediaView({
      state: humans([
        ["me", 1, 1],
        ["ada", 5, -25, { operationId: "op-1", sharingScreen: true }],
      ]),
      sessionId: "me",
      player: { x: 17, z: 10, spawned: true },
      world,
      tv,
      tvOpen: false,
      settings,
    });
    expect(v.self).toMatchObject({ sessionId: "me", x: 17, z: 10, roomId: LOBBY_OPERATION_ID });
    expect(v.others).toEqual([
      { sessionId: "ada", x: 5, z: -25, roomId: "op-1", operationId: "op-1", sharingScreen: true },
    ]);
    expect(v.watchTv).toBe(true);
    expect(v.voiceLevel).toBeCloseTo(0.4);
    expect(v.pushToTalk).toBe(true);
  });

  test("the TV is received only in the lobby within range, or when open", () => {
    const base = {
      state: humans([["me", 0, 0]]),
      sessionId: "me",
      world,
      tv,
      settings,
    };
    const away = { x: 5, z: -25, spawned: true };
    expect(mediaView({ ...base, player: away, tvOpen: false }).watchTv).toBe(false);
    expect(mediaView({ ...base, player: away, tvOpen: true }).watchTv).toBe(true);
    expect(mediaView({ ...base, player: away, tv: null, tvOpen: false }).watchTv).toBe(false);
  });
});
