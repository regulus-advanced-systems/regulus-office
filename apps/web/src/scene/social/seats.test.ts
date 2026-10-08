import { describe, expect, test } from "bun:test";
import { SPECIAL_ROOM_KINDS } from "@regulus/protocol";
import { specialRoomSeats } from "@regulus/room-layout";
import { specialDressing } from "../compound/special.ts";
import { rowPlacement, testState, testWorld } from "../compound/testing.ts";
import { type CompoundWorld, compoundWorld, type WorldRoom } from "../compound/world.ts";
import { seatedPlacement } from "./seatPose.ts";
import { nearestFreeSeat, roomSeats, seatByKey, takenSeats, worldSeats } from "./seats.ts";

const world = testWorld(
  [
    { id: "apollo", placement: rowPlacement(4), deskCount: 2 },
    { id: "zeus", placement: rowPlacement(28, 10, 8), deskCount: 3 },
  ],
  ["apollo"],
);
const landingWorld = compoundWorld(
  testState([], 48, { levelId: "lv-a", landing: true }),
  new Set(),
  "lv-a",
) as CompoundWorld;
const room = (id: string) => world.rooms.find((r) => r.id === id) as WorldRoom;

describe("special-room seats sit on the furniture the scene draws (#49)", () => {
  test.each([...SPECIAL_ROOM_KINDS])("%s", (kind) => {
    // The landing is another level's fixed room (#269): it has its own world.
    const r = [...world.rooms, ...landingWorld.rooms].find((x) => x.kind === kind) as WorldRoom;
    const dressing = specialDressing(kind, r.size.w, r.size.d);
    const chairs = dressing.extras.filter((e) => /chair/.test(e.piece));
    for (const seat of specialRoomSeats(kind, r.size.w, r.size.d)) {
      const { x, z } = seat.pose;
      const onFurniture = dressing.furniture.some(
        (f) =>
          f.model === seat.furnitureId &&
          x >= f.rect.x &&
          x <= f.rect.x + f.rect.w &&
          z >= f.rect.z &&
          z <= f.rect.z + f.rect.d,
      );
      const onChair = chairs.some(
        (c) =>
          c.piece === seat.furnitureId && Math.hypot(c.position[0] - x, c.position[2] - z) < 0.01,
      );
      expect(onFurniture || onChair, `${kind} ${seat.id}`).toBe(true);
    }
  });
});

describe("seats this viewer can use", () => {
  test("open rooms only: a shut room offers none, and desks never", () => {
    expect(roomSeats(room("zeus"))).toEqual([]);
    expect(roomSeats(room("apollo")).map((s) => s.id)).toEqual([
      "nook-chair-w-seat",
      "nook-chair-e-seat",
    ]);
    const keys = worldSeats(world).map((s) => s.key);
    expect(keys).toContain("lobby/sofa-1");
    expect(keys).toContain("break_room/stool-1w");
    expect(keys).toContain("conference/chair-n1");
    expect(keys.some((k) => k.startsWith("zeus/"))).toBe(false);
    expect(keys.some((k) => /\/d\d+s\d+$/.test(k))).toBe(false);
  });

  test("a key finds its seat in compound metres; a seated human sits close to it", () => {
    const seat = seatByKey(world, "lobby/sofa-2");
    const lobby = room("lobby");
    expect(seat?.x).toBeCloseTo(lobby.origin.x + lobby.size.w - 7.6 + 2, 5);
    expect(seatByKey(world, "lobby/nope")).toBeNull();
    expect(seatByKey(world, "zeus/nook-chair-w-seat")).toBeNull();
    const place = seat ? seatedPlacement(seat) : null;
    expect(place).not.toBeNull();
    const [px, py, pz] = place?.position ?? [0, 0, 0];
    expect(Math.hypot(px - (seat?.x ?? 0), pz - (seat?.z ?? 0))).toBeLessThan(0.6);
    expect(py).toBeGreaterThanOrEqual(0);
  });

  test("E picks the nearest free seat in reach, skipping taken ones", () => {
    const seats = worldSeats(world);
    const sofa1 = seatByKey(world, "lobby/sofa-1");
    if (!sofa1) throw new Error("no sofa");
    const p = { x: sofa1.x, z: sofa1.z - 0.8 };
    expect(nearestFreeSeat(seats, p, new Set())?.key).toBe("lobby/sofa-1");
    expect(nearestFreeSeat(seats, p, new Set(["lobby/sofa-1"]))?.key).toBe("lobby/sofa-2");
    expect(nearestFreeSeat(seats, { x: 0, z: 0 }, new Set())).toBeNull();
    const state = {
      humans: {
        a: { seatId: "lobby/sofa-1" },
        b: { seatId: "" },
        me: { seatId: "lobby/sofa-3" },
      },
    } as unknown as Parameters<typeof takenSeats>[0];
    expect([...takenSeats(state, "me")]).toEqual(["lobby/sofa-1"]);
  });
});

describe("seats are per level (#269)", () => {
  test("a landing offers its two armchairs and none of the lobby's seats", () => {
    const keys = worldSeats(landingWorld).map((s) => s.key);
    expect(keys).toEqual(["landing/armchair-w", "landing/armchair-e"]);
    expect(seatByKey(landingWorld, "lobby/sofa-1")).toBeNull();
    expect(seatByKey(world, "landing/armchair-w")).toBeNull();
  });
});
