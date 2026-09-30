import { describe, expect, test } from "bun:test";
import { officeL2Template as base, HEADING, type Seat, TEMPLATES } from "@regulus/floor-layout";
import {
  BACK_GAP,
  SEATED_BACK_DEPTH,
  SEATED_FRONT_DEPTH,
  SEATED_HEAD_BOTTOM,
  SEATED_HIPS,
  SEATED_SIT_DROP,
  seatedOffset,
  TABLE_GAP,
} from "../avatar/seatedFit.ts";
import { CHAIR_MODEL, chairForSeat, FURNITURE_MODELS } from "./catalog.ts";
import {
  backTopY,
  chairRect,
  chairSetBack,
  seatModel,
  sitAnchor,
  sitAnchors,
  tableDistance,
} from "./sitAnchor.ts";

const templates = [...TEMPLATES.values()];

describe("sit anchors (#163)", () => {
  test("every seat sits on a model with measured sit data", () => {
    let checked = 0;
    for (const t of templates)
      for (const seat of t.seats) {
        const model = seatModel(t, seat);
        expect(model?.spec.sit, `${t.id}/${seat.id}`).toBeDefined();
        checked++;
      }
    expect(checked).toBeGreaterThan(60);
    expect(CHAIR_MODEL.sit).toBeDefined();
    expect(FURNITURE_MODELS.couch?.sit).toBeDefined();
    expect(FURNITURE_MODELS.armchair?.sit).toBeDefined();
  });

  test("a desk chair's anchor: cushion at 0.31 m, backrest 0.13 m behind the seat point, any heading", () => {
    for (const heading of [HEADING.north, HEADING.east, HEADING.south, HEADING.west]) {
      const seat: Seat = { id: "s", kind: "desk", pose: { x: 5, z: 7, heading } };
      const a = sitAnchor({ ...base, seats: [seat] }, seat);
      expect(a.seatY).toBeCloseTo(0.315, 3);
      expect(a.backFwd).toBeCloseTo(-0.1285, 3);
    }
    expect(chairRect({ x: 1, z: 2, heading: 0 })).toEqual({ x: 0.75, z: 1.75, w: 0.5, d: 0.5 });
  });

  test("seated on any seat: hips within 3 cm of the cushion, back in front of the backrest, head over it", () => {
    const wrong: string[] = [];
    for (const t of templates) {
      const anchors = sitAnchors(t);
      for (const seat of t.seats) {
        const a = anchors.get(seat.id);
        const model = seatModel(t, seat);
        if (!a || !model) throw new Error(`${t.id}/${seat.id} has no anchor`);
        const { forward, lift } = seatedOffset(a);
        const hipsY = lift + SEATED_HIPS.up;
        const hipsFwd = forward - SEATED_HIPS.back;
        const where = `${t.id}/${seat.id} (${seat.kind})`;
        if (Math.abs(hipsY - a.seatY) > 0.03) wrong.push(`${where}: hips ${hipsY - a.seatY} m off`);
        if (hipsY - SEATED_SIT_DROP < a.seatY - 1e-9) wrong.push(`${where}: sinks into the seat`);
        const backOf = hipsFwd - SEATED_BACK_DEPTH;
        if (backOf < a.backFwd + BACK_GAP - 1e-9) wrong.push(`${where}: back behind the backrest`);
        if (hipsY + SEATED_HEAD_BOTTOM < backTopY(model))
          wrong.push(`${where}: backrest top ${backTopY(model)} m cuts into the head`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("the seated body ends short of the table; close chairs are pulled out, others stay put", () => {
    const wrong: string[] = [];
    let pulled = 0;
    for (const t of templates)
      for (const seat of t.seats) {
        const edge = tableDistance(t, seat);
        const chair = chairForSeat(seat.kind);
        if (edge === null || !chair) continue;
        const { forward } = seatedOffset(sitAnchor(t, seat));
        const front = forward - SEATED_HIPS.back + SEATED_FRONT_DEPTH;
        if (front > edge - TABLE_GAP + 1e-9) wrong.push(`${t.id}/${seat.id}: ${front} vs ${edge}`);
        const setBack = chairSetBack(t, seat, chair);
        // Only the meeting chairs that stand 0.25 m from the table move visibly (15 cm).
        if (setBack > 0.01) {
          pulled++;
          if (edge > 0.25 + 1e-9) wrong.push(`${t.id}/${seat.id} pulled ${setBack} m`);
        }
      }
    expect(wrong).toEqual([]);
    expect(pulled).toBe(9);
  });

  test("anchors are cached per template", () => {
    const t = templates[0];
    if (!t) throw new Error("no templates");
    expect(sitAnchors(t)).toBe(sitAnchors(t));
  });
});
