import { describe, expect, test } from "bun:test";
import { facingError, headingDelta, MAX_FACING_ERROR, seatFocus, tableFocus } from "./facing.ts";
import { HEADING } from "./geometry.ts";
import { lobbyTemplate } from "./templates/lobby.ts";
import { TEMPLATES } from "./templates/tiers.ts";

const deg = (r: number) => Math.round((r * 180) / Math.PI);

describe("seat facing (#143)", () => {
  test("every seat on every template faces its table, desk or coffee table within 20 degrees", () => {
    const wrong: string[] = [];
    for (const t of TEMPLATES.values()) {
      for (const seat of t.seats) {
        const focus = seatFocus(t, seat);
        if (!focus) {
          wrong.push(`${t.id}/${seat.id}: nothing to face`);
          continue;
        }
        const err = facingError(seat.pose.heading, seat.pose, focus);
        if (err > MAX_FACING_ERROR) wrong.push(`${t.id}/${seat.id}: off by ${deg(err)} deg`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("lounge seats face the coffee table, which sits between the couch and the TV", () => {
    const couch = lobbyTemplate.seats.find((s) => s.id === "couch-1");
    if (!couch) throw new Error("no couch seat");
    const focus = seatFocus(lobbyTemplate, couch);
    const table = lobbyTemplate.obstacles.find((o) => o.id === "coffee-table");
    expect(focus?.x).toBeCloseTo((table?.rect.x ?? 0) + (table?.rect.w ?? 0) / 2, 9);
    expect(couch.pose.heading).toBe(HEADING.west);
  });
});

describe("helpers", () => {
  test("tableFocus is the centre of a square table and the nearest point on a long one's axis", () => {
    expect(tableFocus({ x: 0, z: 0, w: 1, d: 1 }, { x: 5, z: 5 })).toEqual({ x: 0.5, z: 0.5 });
    // 3.2 x 1.6 shared table: a chair at x = 0.75 faces x = 0.8 (end of the axis segment).
    expect(tableFocus({ x: 0, z: 0, w: 3.2, d: 1.6 }, { x: 0.75, z: -0.5 })).toEqual({
      x: 0.8,
      z: 0.8,
    });
    expect(tableFocus({ x: 0, z: 0, w: 1, d: 2.4 }, { x: -1, z: 2 })).toEqual({ x: 0.5, z: 1.9 });
  });

  test("headingDelta wraps around", () => {
    expect(headingDelta(HEADING.south, -Math.PI)).toBeCloseTo(0, 9);
    expect(headingDelta(HEADING.east, HEADING.west)).toBeCloseTo(Math.PI, 9);
    expect(headingDelta(0.1, -0.1)).toBeCloseTo(0.2, 9);
  });

  test("facingError is zero when looking straight at the point", () => {
    expect(facingError(HEADING.north, { x: 0, z: 0 }, { x: 0, z: -2 })).toBeCloseTo(0, 9);
    expect(facingError(HEADING.north, { x: 0, z: 0 }, { x: 0, z: 2 })).toBeCloseTo(Math.PI, 9);
  });
});
