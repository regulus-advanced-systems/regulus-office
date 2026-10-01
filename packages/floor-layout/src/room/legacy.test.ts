import { describe, expect, test } from "bun:test";
import { legacyRoomSize } from "../compound/autoplace.ts";
import { deskSeats } from "../query.ts";
import { TIER_TEMPLATES } from "../templates/tiers.ts";
import { roomLayoutSvg } from "./debug-svg.ts";
import { generateRoom, maxDeskCount } from "./generate.ts";
import {
  canonicalSeatId,
  isLegacyTemplateId,
  LEGACY_SEAT_IDS,
  legacyDeskCount,
  legacySeatId,
} from "./legacy.ts";
import { deskSeatIds, parseRoomSeatId, roomDeskSeatIds, roomSeatId } from "./seat-ids.ts";

describe("seat ids", () => {
  test("format and parse round-trip; other ids are not room seats", () => {
    expect(roomSeatId(12, 3)).toBe("d12s3");
    expect(parseRoomSeatId("d12s3")).toEqual({ desk: 12, seat: 3 });
    for (const id of ["d0s1", "d1s5", "d1s0", "table-a-n1", "d01s1", "d1s1x"])
      expect(parseRoomSeatId(id)).toBeNull();
    expect(deskSeatIds(2)).toEqual(["d2s1", "d2s2", "d2s3", "d2s4"]);
    expect(roomDeskSeatIds(2)).toEqual([...deskSeatIds(1), ...deskSeatIds(2)]);
  });
});

describe("migrated floors keep their seats", () => {
  test.each(Object.values(TIER_TEMPLATES).map((t) => [t.id, t] as const))(
    "%s: every desk seat maps to a distinct generated seat",
    (id, template) => {
      const map = LEGACY_SEAT_IDS[id] ?? {};
      const old = deskSeats(template).map((s) => s.id);
      expect(Object.keys(map)).toEqual(old);
      const count = legacyDeskCount(id) ?? 0;
      expect(count).toBe(Math.ceil(old.length / 4));
      const generated = new Set(roomDeskSeatIds(count));
      expect(new Set(Object.values(map)).size).toBe(old.length);
      for (const seat of old) {
        const mapped = canonicalSeatId(id, seat);
        expect(generated.has(mapped)).toBe(true);
        expect(legacySeatId(id, mapped)).toBe(seat);
      }
      expect(isLegacyTemplateId(id)).toBe(true);
    },
  );

  test("the shared tables keep their order: table-a's seats become desk 1", () => {
    expect(canonicalSeatId("office-small", "table-a-n1")).toBe("d1s1");
    expect(canonicalSeatId("office-small", "table-a-s2")).toBe("d1s4");
    expect(canonicalSeatId("office-small", "ceo-seat")).toBe("d2s2");
    expect(canonicalSeatId("office-l2", "table-b-n1")).toBe("d2s1");
    expect(legacyDeskCount("office-large")).toBe(5);
    expect(canonicalSeatId("room", "d3s2")).toBe("d3s2");
    expect(isLegacyTemplateId("room")).toBe(false);
  });

  test.each(Object.values(TIER_TEMPLATES).map((t) => [t.id, t] as const))(
    "%s: the compound's migrated room size fits the migrated desks",
    (id, template) => {
      const size = legacyRoomSize(deskSeats(template).length);
      const count = legacyDeskCount(id) ?? 99;
      expect(maxDeskCount(size.width, size.depth)).toBeGreaterThanOrEqual(count);
      const l = generateRoom({
        ...size,
        doorSide: "south",
        deskCount: count,
        decorStyle: "ops_room",
      });
      for (const seat of Object.values(LEGACY_SEAT_IDS[id] ?? {}))
        expect(l.seats.some((s) => s.id === seat)).toBe(true);
    },
  );
});

test("the debug SVG draws a room", () => {
  const svg = roomLayoutSvg(
    generateRoom({ width: 6, depth: 5, doorSide: "west", deskCount: 2, decorStyle: "lab" }),
  );
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain(">d2</text>");
  expect(svg.endsWith("</svg>")).toBe(true);
});
