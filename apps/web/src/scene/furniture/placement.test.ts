import { describe, expect, test } from "bun:test";
import { HEADING, lobbyTemplate, WALL_THICKNESS, wallById } from "@regulus/floor-layout";
import { WALL_SURFACE_GAP } from "../room/roomPieces.ts";
import {
  anchorPlacement,
  boxSize,
  centreBottomOffset,
  fitToFootprint,
  furnitureHeading,
  headingAwayFromNearestWall,
  PLANT_BASE_FOOTPRINT,
  PLANT_MAX_GROWTH,
  propTargetHeight,
  restingHeight,
  snapHeading,
  visualFootprint,
} from "./placement.ts";

const t = lobbyTemplate;
const obstacle = (id: string) => {
  const o = t.obstacles.find((x) => x.id === id);
  if (!o) throw new Error(`no obstacle ${id}`);
  return o;
};

describe("bounds helpers", () => {
  const bounds = { min: { x: -0.01, y: 0, z: -0.38 }, max: { x: 0.72, y: 0.38, z: 0.18 } };
  test("boxSize and centreBottomOffset", () => {
    const s = boxSize(bounds);
    expect(s.w).toBeCloseTo(0.73, 9);
    expect(s.h).toBeCloseTo(0.38, 9);
    expect(s.d).toBeCloseTo(0.56, 9);
    const o = centreBottomOffset(bounds);
    expect(o[0]).toBeCloseTo(-0.355, 9);
    expect(o[1]).toBe(-0);
    expect(o[2]).toBeCloseTo(0.1, 9);
  });
});

describe("visualFootprint", () => {
  test("couch grows over its cushion seats", () => {
    const couch = obstacle("couch").rect;
    const cushionX = Math.min(
      ...t.seats.filter((s) => s.furnitureId === "couch").map((s) => s.pose.x),
    );
    const r = visualFootprint(obstacle("couch"), t.seats);
    expect(r.x).toBeCloseTo(cushionX - 0.25, 9);
    expect(r.x).toBeLessThan(couch.x);
    expect(r.x + r.w).toBeCloseTo(couch.x + couch.w, 9);
    expect(r.z).toBeCloseTo(couch.z, 9);
    expect(r.z + r.d).toBeCloseTo(couch.z + couch.d, 9);
  });

  test("everything else keeps its template rect", () => {
    expect(visualFootprint(obstacle("reception-desk"), t.seats)).toEqual(
      obstacle("reception-desk").rect,
    );
    expect(visualFootprint(obstacle("jukebox"), [])).toEqual(obstacle("jukebox").rect);
  });
});

describe("furnitureHeading", () => {
  test("a desk faces the way its sitter faces", () => {
    expect(furnitureHeading(obstacle("reception-desk"), t.seats, t.size)).toBe(HEADING.south);
    expect(furnitureHeading(obstacle("couch"), t.seats, t.size)).toBe(HEADING.west);
  });

  test("an interactable faces its standAt pose", () => {
    expect(furnitureHeading(obstacle("coffee-machine"), t.seats, t.size)).toBeCloseTo(
      HEADING.south,
      9,
    );
    expect(furnitureHeading(obstacle("jukebox"), t.seats, t.size)).toBeCloseTo(HEADING.east, 9);
  });

  test("snapHeading rounds to a compass axis and stays in (-pi, pi]", () => {
    expect(snapHeading(-1.89)).toBeCloseTo(HEADING.east, 9);
    expect(snapHeading(0.3)).toBe(HEADING.north);
    expect(snapHeading(3.0)).toBeCloseTo(HEADING.south, 9);
    expect(snapHeading(-3.0)).toBeCloseTo(HEADING.south, 9);
    expect(snapHeading(1.7)).toBeCloseTo(HEADING.west, 9);
  });

  test("otherwise it faces away from the nearest wall", () => {
    expect(furnitureHeading(obstacle("coffee-counter"), t.seats, t.size)).toBe(HEADING.south);
    expect(headingAwayFromNearestWall({ x: 0.1, z: 5, w: 0.5, d: 0.5 }, t.size)).toBe(HEADING.east);
    expect(headingAwayFromNearestWall({ x: 13.3, z: 5, w: 0.5, d: 0.5 }, t.size)).toBe(
      HEADING.west,
    );
    expect(headingAwayFromNearestWall({ x: 7, z: 10.4, w: 0.5, d: 0.5 }, t.size)).toBe(
      HEADING.north,
    );
  });
});

describe("restingHeight", () => {
  const heightOf = (kind: string) => (kind === "counter" ? 0.9 : 0.5);
  test("a coffee machine inside the counter footprint sits on the counter", () => {
    expect(restingHeight(obstacle("coffee-machine"), t.obstacles, heightOf)).toBe(0.9);
  });
  test("free-standing pieces and supports themselves stay on the floor", () => {
    expect(restingHeight(obstacle("jukebox"), t.obstacles, heightOf)).toBe(0);
    expect(restingHeight(obstacle("coffee-counter"), t.obstacles, heightOf)).toBe(0);
    expect(restingHeight(obstacle("plant-se-big"), t.obstacles, heightOf)).toBe(0);
  });
});

describe("fitToFootprint", () => {
  const desk = { w: 0.73, h: 0.38, d: 0.56 };
  const rect = { x: 9, z: 2.4, w: 2.5, d: 0.9 };

  test("stretches x/z to the rect and scales height to the target", () => {
    const p = fitToFootprint(desk, rect, HEADING.south, { targetHeight: 0.76 });
    expect(p.position).toEqual([10.25, 0, 2.85]);
    expect(p.rotationY).toBeCloseTo(0, 9);
    expect(p.scale[0]).toBeCloseTo(2.5 / 0.73, 9);
    expect(p.scale[2]).toBeCloseTo(0.9 / 0.56, 9);
    expect(p.scale[1]).toBeCloseTo(2, 9);
  });

  test("a quarter turn swaps which model axis fits which rect side", () => {
    const p = fitToFootprint(desk, rect, HEADING.west, { targetHeight: 0.76 });
    expect(Math.abs(p.rotationY)).toBeCloseTo(Math.PI / 2, 9);
    expect(p.scale[0]).toBeCloseTo(0.9 / 0.73, 9);
    expect(p.scale[2]).toBeCloseTo(2.5 / 0.56, 9);
  });

  test("respects the model's own front direction", () => {
    const p = fitToFootprint(desk, rect, HEADING.south, { modelHeading: HEADING.north });
    expect(Math.abs(p.rotationY)).toBeCloseTo(Math.PI, 9);
  });

  test("without a target height it uses the smaller footprint ratio", () => {
    const p = fitToFootprint(desk, rect, HEADING.south);
    expect(p.scale[1]).toBeCloseTo(Math.min(2.5 / 0.73, 0.9 / 0.56), 9);
  });

  test("uniform keeps proportions from the height", () => {
    const plant = { w: 0.25, h: 0.54, d: 0.29 };
    const p = fitToFootprint(plant, { x: 0.2, z: 0.2, w: 0.5, d: 0.5 }, 0, {
      uniform: true,
      targetHeight: 1.2,
    });
    const s = 1.2 / 0.54;
    expect(p.scale).toEqual([s, s, s]);
    expect(p.position).toEqual([0.45, 0, 0.45]);
  });

  test("degenerate model sizes do not produce infinities", () => {
    const p = fitToFootprint({ w: 0, h: 0, d: 0 }, rect, 0, { targetHeight: 1 });
    for (const s of p.scale) expect(Number.isFinite(s)).toBe(true);
  });
});

describe("anchorPlacement", () => {
  test("hangs on the wall's room-facing surface, turned to face the room", () => {
    const north = wallById(t, "north");
    const west = wallById(t, "west");
    const whiteboard = t.wallAnchors.find((a) => a.id === "whiteboard");
    const usage = t.wallAnchors.find((a) => a.id === "usage-wall");
    if (!north || !west || !whiteboard || !usage) throw new Error("lobby changed");

    const wb = anchorPlacement(north, whiteboard);
    expect(wb.position[0]).toBeCloseTo(whiteboard.t, 9);
    expect(wb.position[1]).toBe(1.4);
    expect(wb.position[2]).toBeCloseTo(WALL_THICKNESS / 2 + WALL_SURFACE_GAP, 9);
    expect(wb.rotationY).toBeCloseTo(0, 9);
    expect([wb.width, wb.height]).toEqual([2.4, 1.2]);

    const uw = anchorPlacement(west, usage, 0.1);
    expect(uw.position[0]).toBeCloseTo(WALL_THICKNESS / 2 + WALL_SURFACE_GAP + 0.05, 9);
    expect(uw.position[2]).toBeCloseTo(usage.t, 9);
    expect(uw.rotationY).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe("propTargetHeight", () => {
  const rect = (size: number) => ({ x: 0, z: 0, w: size, d: size });
  test("plants grow with their pot, within limits", () => {
    expect(propTargetHeight("plant", rect(PLANT_BASE_FOOTPRINT), 1.2)).toBeCloseTo(1.2, 9);
    expect(propTargetHeight("plant", rect(0.8), 1.2)).toBeCloseTo(1.2 * 1.6, 9);
    expect(propTargetHeight("plant", rect(3), 1.2)).toBeCloseTo(1.2 * PLANT_MAX_GROWTH, 9);
    expect(propTargetHeight("plant", rect(0.3), 1.2)).toBeCloseTo(1.2, 9);
  });

  test("other props keep their catalog height", () => {
    expect(propTargetHeight("desk", rect(2), 0.76)).toBe(0.76);
  });
});

describe("armchairs", () => {
  test("an armchair grows over its cushion seat, like the couch", () => {
    const chair = obstacle("armchair-n");
    const r = visualFootprint(chair, t.seats);
    expect(r.w * r.d).toBeGreaterThan(chair.rect.w * chair.rect.d);
    expect(furnitureHeading(chair, t.seats, t.size)).toBe(HEADING.south);
  });
});
