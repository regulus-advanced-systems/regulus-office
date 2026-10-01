/**
 * #143: every placed piece faces the right way on every bundled template.
 * Chairs face their table, lounge seats their coffee table, desks their
 * chair, and screens, boards and wall-backed furniture face into the room.
 * Uses the same maths the scene does (`fitToFootprint`, `anchorPlacement`),
 * so a wrong model yaw in the catalog fails here.
 */
import { describe, expect, test } from "bun:test";
import {
  DIRECTION,
  HEADING,
  MAX_FACING_ERROR,
  type ObstacleKind,
  type Rect,
  type RoomTemplate,
  seatFocus,
  TEMPLATES,
  tableFocus,
  type Vec2,
  type Wall,
  wallById,
} from "@regulus/room-layout";
import { CHAIR_MODEL, chairForSeat, FURNITURE_MODELS, TV_MODEL } from "./catalog.ts";
import {
  anchorPlacement,
  fitToFootprint,
  furnitureHeading,
  modelForward,
  SEAT_FOOTPRINT,
  SEAT_FURNITURE,
  visualFootprint,
  wallPropPlacement,
} from "./placement.ts";

const templates = [...TEMPLATES.values()];
const UNIT = { w: 1, h: 1, d: 1 };
const deg = (r: number) => Math.round((r * 180) / Math.PI);

/** Angle between a ground vector and the direction from `from` to `to`. */
function angleTo(v: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const cos = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz));
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

function angleBetween(a: Vec2, b: Vec2): number {
  return angleTo(a, { x: 0, z: 0 }, b);
}

/** Front of a template piece as the scene draws it. Procedural pieces are built facing +z. */
function pieceForward(kind: ObstacleKind, rect: Rect, heading: number): Vec2 {
  const modelHeading = FURNITURE_MODELS[kind]?.modelHeading ?? HEADING.south;
  return modelForward(fitToFootprint(UNIT, rect, heading, { modelHeading }).rotationY);
}

/** Nearest perimeter wall to a rect's centre. */
function nearestWall(t: RoomTemplate, rect: Rect): { wall: Wall; distance: number } {
  const c = { x: rect.x + rect.w / 2, z: rect.z + rect.d / 2 };
  const ranked = t.walls
    .map((wall) => ({
      wall,
      distance:
        wall.from.x === wall.to.x ? Math.abs(c.x - wall.from.x) : Math.abs(c.z - wall.from.z),
    }))
    .sort((a, b) => a.distance - b.distance);
  const first = ranked[0];
  if (!first) throw new Error(`${t.id} has no walls`);
  return first;
}

describe("seats (#143)", () => {
  test("every chair's front points at its table's centre within 20 degrees", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const t of templates) {
      for (const seat of t.seats) {
        const spec = chairForSeat(seat.kind);
        if (!spec) continue;
        const half = SEAT_FOOTPRINT / 2;
        const rect = { x: seat.pose.x - half, z: seat.pose.z - half, w: 1, d: 1 };
        const yaw = fitToFootprint(UNIT, rect, seat.pose.heading, {
          modelHeading: spec.modelHeading,
        }).rotationY;
        const focus = seatFocus(t, seat);
        if (!focus) throw new Error(`${t.id}/${seat.id} has no table`);
        const err = angleTo(modelForward(yaw), seat.pose, focus);
        checked++;
        if (err > MAX_FACING_ERROR) wrong.push(`${t.id}/${seat.id}: ${deg(err)} deg off`);
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(wrong).toEqual([]);
  });

  test("couches and armchairs face the coffee table in front of them", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const t of templates) {
      for (const o of t.obstacles) {
        if (!SEAT_FURNITURE.has(o.kind)) continue;
        for (const seat of t.seats.filter((s) => s.furnitureId === o.id)) {
          const rect = visualFootprint(o, t.seats);
          const forward = pieceForward(o.kind, rect, furnitureHeading(o, t.seats, t.size));
          const focus = seatFocus(t, seat);
          if (!focus) throw new Error(`${t.id}/${seat.id} faces nothing`);
          const err = angleTo(forward, seat.pose, focus);
          checked++;
          if (err > MAX_FACING_ERROR) wrong.push(`${t.id}/${o.id}: ${deg(err)} deg off`);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
    expect(wrong).toEqual([]);
  });

  test("desks face their chair (drawers on the sitter's side)", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const t of templates) {
      for (const o of t.obstacles) {
        if (SEAT_FURNITURE.has(o.kind) || !FURNITURE_MODELS[o.kind]) continue;
        const seat = t.seats.find((s) => s.furnitureId === o.id);
        if (!seat || (o.kind !== "desk" && o.kind !== "reception_desk")) continue;
        const forward = pieceForward(o.kind, o.rect, furnitureHeading(o, t.seats, t.size));
        const err = angleTo(forward, tableFocus(o.rect, seat.pose), seat.pose);
        checked++;
        if (err > MAX_FACING_ERROR) wrong.push(`${t.id}/${o.id}: ${deg(err)} deg off`);
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect(wrong).toEqual([]);
  });
});

describe("into the room (#143)", () => {
  test("every wall-mounted piece and screen faces away from its wall", () => {
    const wrong: string[] = [];
    for (const t of templates) {
      const hung = [...t.wallAnchors, ...t.wallDecor];
      for (const a of hung) {
        const wall = wallById(t, a.wallId);
        if (!wall) throw new Error(`${t.id}/${a.id}: no wall ${a.wallId}`);
        const normal = DIRECTION[wall.facing];
        let forward: Vec2;
        if ("kind" in a && a.kind === "tv") {
          const tv = wallPropPlacement(wall, a);
          const yaw = fitToFootprint(UNIT, tv.rect, tv.heading, {
            modelHeading: TV_MODEL.modelHeading,
          }).rotationY;
          forward = modelForward(yaw);
        } else {
          forward = modelForward(anchorPlacement(wall, a).rotationY);
        }
        const err = angleBetween(forward, normal);
        if (err > MAX_FACING_ERROR) wrong.push(`${t.id}/${a.id}: ${deg(err)} deg off`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("the lobby TV screen faces the couch", () => {
    const lobby = TEMPLATES.get("lobby");
    const anchor = lobby?.wallAnchors.find((a) => a.kind === "tv");
    const wall = lobby && anchor ? wallById(lobby, anchor.wallId) : undefined;
    if (!lobby || !anchor || !wall) throw new Error("lobby TV missing");
    const tv = wallPropPlacement(wall, anchor);
    const yaw = fitToFootprint(UNIT, tv.rect, tv.heading, {
      modelHeading: TV_MODEL.modelHeading,
    }).rotationY;
    const couch = lobby.obstacles.find((o) => o.kind === "couch");
    if (!couch) throw new Error("no couch");
    const centre = { x: tv.rect.x + tv.rect.w / 2, z: tv.rect.z + tv.rect.d / 2 };
    const couchCentre = { x: couch.rect.x + couch.rect.w / 2, z: couch.rect.z + couch.rect.d / 2 };
    expect(angleTo(modelForward(yaw), centre, couchCentre)).toBeLessThan(Math.PI / 4);
  });

  test("counters, fridges, cabinets, shelves and the jukebox open toward the room", () => {
    const backed: ReadonlySet<ObstacleKind> = new Set([
      "counter",
      "fridge",
      "cabinet",
      "bookshelf",
      "jukebox",
      "coffee_machine",
    ]);
    const wrong: string[] = [];
    let checked = 0;
    for (const t of templates) {
      for (const o of t.obstacles) {
        if (!backed.has(o.kind)) continue;
        const { wall, distance } = nearestWall(t, o.rect);
        expect(distance).toBeLessThan(1);
        const forward = pieceForward(o.kind, o.rect, furnitureHeading(o, t.seats, t.size));
        const err = angleBetween(forward, DIRECTION[wall.facing]);
        checked++;
        if (err > MAX_FACING_ERROR) wrong.push(`${t.id}/${o.id}: ${deg(err)} deg off`);
      }
    }
    expect(checked).toBeGreaterThan(15);
    expect(wrong).toEqual([]);
  });
});

describe("model yaw", () => {
  test("every Kenney model with a front is declared as facing +z (south)", () => {
    const fronted = Object.entries(FURNITURE_MODELS).filter(
      ([kind]) => !["plant", "plant_small", "floor_lamp"].includes(kind),
    );
    for (const [, spec] of fronted) expect(spec?.modelHeading).toBe(HEADING.south);
    expect(CHAIR_MODEL.modelHeading).toBe(HEADING.south);
    expect(TV_MODEL.modelHeading).toBe(HEADING.south);
  });
});
