import { describe, expect, test } from "bun:test";
import { doorStart } from "@regulus/room-layout";
import { DOOR_SIDES } from "@regulus/protocol";
import { placeRoom } from "../placed.ts";
import { rowPlacement, type TestRoom, testWorld } from "../testing.ts";
import { crewSpots, hammerAngle } from "./BuildSites.tsx";
import { ghostWalls } from "./Ghost.tsx";
import { withDraft } from "./preview.ts";
import {
  classify,
  diffRooms,
  holdArrivals,
  pieceKey,
  TRANSITION_SECONDS,
  transitionScales,
} from "./transitions.ts";

const placed = (rooms: TestRoom[], enterable?: string[]) =>
  testWorld(rooms, enterable).rooms.map(placeRoom);
const apollo = (extra: Partial<TestRoom> = {}): TestRoom => ({
  id: "apollo",
  name: "Apollo",
  placement: rowPlacement(4),
  ...extra,
});

describe("room transitions", () => {
  test("which changes animate", () => {
    const [a] = testWorld([apollo()]).rooms.filter((r) => r.kind === "project");
    if (!a) throw new Error("no room");
    expect(classify(undefined, a)).toBe("raise");
    expect(classify(a, undefined)).toBe("demolish");
    expect(classify(a, { ...a, buildState: "building" })).toBeNull();
    expect(classify({ ...a, buildState: "building" }, a)).toBe("reveal");
    expect(classify(a, { ...a, deskCount: 2 })).toBe("grow");
    expect(classify(a, { ...a, decorStyle: "lab" })).toBe("grow");
    expect(classify(a, { ...a, rect: { ...a.rect, x: a.rect.x + 1 } })).toBe("move");
    expect(classify(a, { ...a, doorSide: "west" })).toBe("move");
    // A door unlocking for this viewer, or robots coming and going, are not transitions.
    expect(classify(a, { ...a, enterable: !a.enterable, robotsWorking: 3 })).toBeNull();
  });

  test("reveal: the scaffolding goes, the interior comes, the shared walls stay put", () => {
    const before = placed([apollo({ building: true })]);
    const after = placed([apollo()]);
    const [t, ...rest] = diffRooms(before, after);
    expect(rest).toHaveLength(0);
    if (!t) throw new Error("no transition");
    expect(t.kind).toBe("reveal");
    expect(t.departures.some((p) => p.piece === "scaffold")).toBe(true);
    expect(t.arrivals.some((p) => p.piece === "scaffold")).toBe(false);
    expect(t.arrivals.length).toBeGreaterThan(10);
    const kept = new Set(before.flatMap((p) => p.pieces).map(pieceKey));
    for (const p of t.arrivals) expect(kept.has(pieceKey(p))).toBe(false);
    expect(t.seconds).toBe(TRANSITION_SECONDS.reveal);
  });

  test("grow: only the new desk's pieces rise; while they do, the room holds them back", () => {
    const before = placed([apollo()]);
    const after = placed([apollo({ deskCount: 2 })]);
    const [t] = diffRooms(before, after);
    if (!t) throw new Error("no transition");
    expect(t.kind).toBe("grow");
    expect(t.arrivals.length).toBeGreaterThan(0);
    expect(t.arrivals.some((p) => p.piece === "laptop")).toBe(true);
    const room = after.find((r) => r.room.id === "apollo");
    const all = (room?.pieces.length ?? 0) + (room?.laptops.length ?? 0);
    const held = holdArrivals(after, [t]).find((r) => r.room.id === "apollo");
    expect((held?.pieces.length ?? 0) + (held?.laptops.length ?? 0)).toBe(all - t.arrivals.length);
    expect(held?.laptops.length).toBe(held?.laptopSeats.length);
    // Nothing else changes, so nothing else is held.
    expect(holdArrivals(after, [])).toBe(after);
  });

  test("demolish and move: everything goes (and comes back elsewhere)", () => {
    const before = placed([apollo()]);
    const [gone] = diffRooms(before, placed([]));
    expect(gone?.kind).toBe("demolish");
    expect(gone?.arrivals).toHaveLength(0);
    expect(gone?.departures.length).toBe(
      (before.find((r) => r.room.id === "apollo")?.pieces.length ?? 0) +
        (before.find((r) => r.room.id === "apollo")?.laptops.length ?? 0),
    );
    const [moved] = diffRooms(before, placed([apollo({ placement: rowPlacement(16) })]));
    expect(moved?.kind).toBe("move");
    // Dust where it stood.
    expect(moved?.footprint.x).toBe(4 * 2);
  });

  test("nothing plays for an unchanged compound or a door that unlocks", () => {
    const rooms = [apollo()];
    expect(diffRooms(placed(rooms), placed(rooms))).toEqual([]);
    expect(diffRooms(placed(rooms, []), placed(rooms))).toEqual([]);
  });

  test("what goes sinks before what comes rises; both end settled", () => {
    for (const kind of Object.keys(TRANSITION_SECONDS) as (keyof typeof TRANSITION_SECONDS)[]) {
      const s = TRANSITION_SECONDS[kind];
      const end = transitionScales(kind, s, s);
      expect(end.departing).toBe(0);
      if (kind !== "demolish") expect(end.arriving).toBeCloseTo(1, 5);
      const start = transitionScales(kind, 0, s);
      expect(start.arriving).toBeCloseTo(0, 5);
    }
    const mid = transitionScales("reveal", 0.3, TRANSITION_SECONDS.reveal);
    expect(mid.departing).toBeGreaterThan(0.5);
    expect(mid.arriving).toBe(0);
  });
});

describe("ghost and build sites", () => {
  test("the ghost's walls leave the two-tile door open on its side", () => {
    const rect = { x: 3, y: 5, w: 8, d: 6 };
    for (const side of DOOR_SIDES) {
      const walls = ghostWalls(rect, side, 2);
      const total = walls.reduce((n, w) => n + w.len, 0);
      expect(total).toBeCloseTo(2 * (16 + 12) - 4);
      const door = doorStart(rect, side);
      const alongX = side === "north" || side === "south";
      const mid = alongX ? (door.x + 1) * 2 : (door.y + 1) * 2;
      const onWall = walls.filter((w) => w.alongX === alongX);
      const fixed = { north: 10, south: 22, west: 6, east: 22 }[side];
      for (const w of onWall.filter((x) => (alongX ? x.z : x.x) === fixed)) {
        const c = alongX ? w.x : w.z;
        expect(Math.abs(c - mid)).toBeGreaterThanOrEqual(w.len / 2 + 2 - 1e-9);
      }
    }
  });

  test("the crew stands inside the site; hammers strike fast and lift slowly", () => {
    for (const [w, d] of [
      [8, 8],
      [24, 24],
    ] as const) {
      for (const s of crewSpots(w, d)) {
        expect(s.x).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(w);
        expect(s.z).toBeGreaterThan(0);
        expect(s.z).toBeLessThan(d);
      }
    }
    const angles = Array.from({ length: 70 }, (_, i) => hammerAngle(i / 100));
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(-1.1 - 1e-9);
    expect(Math.max(...angles)).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(hammerAngle(0.7)).toBeCloseTo(hammerAngle(0));
  });

  test("room settings' preview applies to its room only", () => {
    const rooms = testWorld([apollo(), { id: "zeus", placement: rowPlacement(16) }]).rooms;
    expect(withDraft(rooms, null)).toBe(rooms);
    expect(withDraft(rooms, { floorId: "apollo", deskCount: 1, decorStyle: "ops_room" })).toBe(
      rooms,
    );
    const drafted = withDraft(rooms, { floorId: "apollo", deskCount: 3, decorStyle: "lab" });
    expect(drafted.find((r) => r.id === "apollo")).toMatchObject({
      deskCount: 3,
      decorStyle: "lab",
    });
    expect(drafted.find((r) => r.id === "zeus")).toBe(rooms.find((r) => r.id === "zeus"));
  });
});
