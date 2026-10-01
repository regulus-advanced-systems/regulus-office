import { describe, expect, test } from "bun:test";
import { HEADING, officeL2Template, type Seat } from "@regulus/room-layout";
import { SEATED_HIPS, seatedOffset } from "../avatar/seatedFit.ts";
import { laptopPlacement } from "../laptops/placement.ts";
import { freeDeskAt } from "./deskInteraction.ts";
import {
  DECAL_BEHIND,
  decalPlacement,
  henchmanPlacement,
  laptopOrigin,
  SCREEN_TOP,
} from "./seatPlacement.ts";

const seat = (id: string, x: number, z: number, heading: number): Seat => ({
  id,
  kind: "desk",
  pose: { x, z, heading },
});

describe("henchman seat placement", () => {
  test("seated henchmen sit on the sit anchor facing the desk; standing ones on the floor", () => {
    const s = seat("s", 4, 6, HEADING.north);
    const anchor = { seatY: 0.31, backFwd: -0.13 };
    const sitting = henchmanPlacement(s, true, anchor);
    const { forward, lift } = seatedOffset(anchor);
    expect(sitting.position[1]).toBeCloseTo(lift, 9);
    // Moved toward the desk (north, -z) so the hips land on the cushion, and facing north.
    expect(sitting.position[2]).toBeCloseTo(6 - forward, 9);
    expect(sitting.position[0]).toBeCloseTo(4, 9);
    expect(sitting.rotationY).toBeCloseTo(HEADING.north, 6);
    // The Hips bone lands just above the cushion, in front of the backrest.
    expect(lift + SEATED_HIPS.up - anchor.seatY).toBeCloseTo(0.015, 6);
    expect(forward - SEATED_HIPS.back).toBeGreaterThan(anchor.backFwd);
    expect(henchmanPlacement(s, false, anchor).position).toEqual([4, 0, 6]);
  });

  test("bubbles start at the top of the desk's laptop", () => {
    const desk = officeL2Template.seats.find((s) => s.kind === "desk") as Seat;
    const origin = laptopOrigin(officeL2Template, desk);
    const [x, y, z] = laptopPlacement(officeL2Template, desk).position;
    expect(origin).toEqual({ x, y: y + SCREEN_TOP, z });
  });

  test("decals lie behind the chair and read along the iso axis", () => {
    const north = decalPlacement(seat("n", 4, 6, HEADING.north));
    expect(north.position[2]).toBeCloseTo(6 + DECAL_BEHIND, 6);
    expect(north.rotationY).toBe(0);
    const east = decalPlacement(seat("e", 4, 6, HEADING.east));
    expect(east.position[0]).toBeCloseTo(4 - DECAL_BEHIND, 6);
    expect(east.rotationY).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("E at a free desk", () => {
  const seats = [seat("a", 2, 2, 0), seat("b", 5, 2, 0)];

  test("the nearest desk within reach, when free", () => {
    expect(freeDeskAt(seats, { x: 2.3, z: 2.5 }, () => false)?.id).toBe("a");
    expect(freeDeskAt(seats, { x: 4.5, z: 2 }, () => false)?.id).toBe("b");
    expect(freeDeskAt(seats, { x: 20, z: 20 }, () => false)).toBeNull();
  });

  test("an occupied nearest desk is left to the terminal (scene/laptops)", () => {
    expect(freeDeskAt(seats, { x: 2.3, z: 2.5 }, (id) => id === "a")).toBeNull();
  });
});
