import { describe, expect, test } from "bun:test";
import { HEADING, OBSTACLE_KINDS, SEAT_KINDS } from "@regulus/room-layout";
import { Box3, Vector3 } from "three";
import { CHAIR_MODEL } from "../furniture/catalog.ts";
import { LAIR_MODEL_COMPONENTS } from "./components/LairModels.tsx";
import { CONSOLE_LAMPS } from "./geometry/consoles.ts";
import { isPieceId, pieceGeometry } from "./kit.ts";
import {
  LAIR_CHAIR,
  LAIR_MODEL_IDS,
  LAIR_MODELS,
  LAIR_PROP_KINDS,
  LAIR_SEAT_MODELS,
  type LairModelId,
  lairModelPlacement,
  lairSitSpec,
} from "./models.ts";
import { placementMatrix } from "./placements.ts";

describe("model id → piece map (for the room generator, #182)", () => {
  test("every room-layout obstacle kind and every lair prop kind has a model", () => {
    for (const id of [...OBSTACLE_KINDS, ...LAIR_PROP_KINDS]) {
      const model = LAIR_MODELS[id];
      expect(model).toBeDefined();
      expect(isPieceId(model.piece)).toBe(true);
    }
  });

  test("the published id list has no duplicates and matches the map exactly", () => {
    expect(new Set(LAIR_MODEL_IDS).size).toBe(LAIR_MODEL_IDS.length);
    expect(Object.keys(LAIR_MODELS).sort()).toEqual([...LAIR_MODEL_IDS].sort());
  });

  test("the id → component map has a component for every id", () => {
    expect(Object.keys(LAIR_MODEL_COMPONENTS).sort()).toEqual([...LAIR_MODEL_IDS].sort());
    for (const id of LAIR_MODEL_IDS) expect(typeof LAIR_MODEL_COMPONENTS[id]).toBe("function");
  });

  test("every seat kind resolves: a chair, or null where the furniture is the seat", () => {
    for (const kind of SEAT_KINDS) expect(kind in LAIR_SEAT_MODELS).toBe(true);
    expect(LAIR_SEAT_MODELS.couch).toBeNull();
    expect(LAIR_SEAT_MODELS.desk).toBe(LAIR_CHAIR);
  });

  test("consoles carry their blinking lamp sockets", () => {
    expect(LAIR_MODELS.console.lamps).toBe(CONSOLE_LAMPS);
    expect(CONSOLE_LAMPS.length).toBeGreaterThan(10);
  });
});

describe("sit specs stay data-driven per chair model (#163/#167)", () => {
  test("the swivel chair's cushion and backrest match the desk chair fit", () => {
    const spec = lairSitSpec(LAIR_CHAIR);
    expect(spec).toBeDefined();
    if (!spec) return;
    const seatY = spec.seatTop * spec.size.h;
    // Within 3 cm of the #163 desk chair (0.82 m tall, cushion at 38.4 %).
    const kenney = (CHAIR_MODEL.sit?.seatTop ?? 0) * CHAIR_MODEL.targetHeight;
    expect(Math.abs(seatY - kenney)).toBeLessThan(0.03);
    expect(spec.backTop).toBeCloseTo(1, 2);
    expect(spec.backFront).toBeGreaterThan(0);
    expect(spec.backFront).toBeLessThan(0.5);
  });

  test("specs are fractions of the built mesh's bounds", () => {
    for (const model of [LAIR_CHAIR, LAIR_MODELS.couch, LAIR_MODELS.armchair]) {
      const spec = lairSitSpec(model);
      const { body } = pieceGeometry(model.piece);
      body.computeBoundingBox();
      const box = body.boundingBox;
      expect(spec?.size.h).toBeCloseTo((box?.max.y ?? 0) - (box?.min.y ?? 0), 2);
      expect(spec?.size.d).toBeCloseTo((box?.max.z ?? 0) - (box?.min.z ?? 0), 2);
      for (const f of [spec?.seatTop, spec?.backFront, spec?.backTop]) {
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
    expect(lairSitSpec(LAIR_MODELS.couch)?.armrestsInner).toBeGreaterThan(0.5);
    expect(lairSitSpec(LAIR_MODELS.desk)).toBeUndefined();
  });
});

describe("lairModelPlacement fits a model to its footprint", () => {
  const rect = { x: 3, z: 4, w: 1.6, d: 1.2 };

  function worldBounds(id: LairModelId, heading: number) {
    const p = lairModelPlacement(id, rect, heading);
    const { body } = pieceGeometry(p.piece);
    body.computeBoundingBox();
    const box = (body.boundingBox ?? new Box3()).clone().applyMatrix4(placementMatrix(p));
    return { p, box };
  }

  test("a desk fills its rect and stands on the floor", () => {
    const { box } = worldBounds("desk", HEADING.south);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.min.x).toBeCloseTo(rect.x, 2);
    expect(box.max.x).toBeCloseTo(rect.x + rect.w, 2);
    expect(box.min.z).toBeCloseTo(rect.z, 2);
    expect(box.max.z).toBeCloseTo(rect.z + rect.d, 2);
    expect(box.getCenter(new Vector3()).x).toBeCloseTo(rect.x + rect.w / 2, 2);
  });

  test("turned a quarter, the model swaps its axes into the same rect", () => {
    const { box } = worldBounds("console", HEADING.east);
    expect(box.max.x - box.min.x).toBeCloseTo(rect.w, 2);
    expect(box.max.z - box.min.z).toBeCloseTo(rect.d, 2);
  });

  test("uniform models keep their authored size", () => {
    const { p } = worldBounds("plant", HEADING.south);
    expect(p.scale?.[0]).toBeCloseTo(1, 5);
    expect(p.scale?.[1]).toBeCloseTo(1, 5);
  });
});
