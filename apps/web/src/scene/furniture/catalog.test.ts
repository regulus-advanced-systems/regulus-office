import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OBSTACLE_KINDS } from "@regulus/floor-layout";
import {
  CHAIR_MODEL,
  chairForSeat,
  FURNITURE_MODELS,
  MODEL_URLS,
  PLACEHOLDER_HEIGHTS,
  TV_MODEL,
} from "./catalog.ts";

describe("catalog", () => {
  test("every referenced model exists in packages/assets and is a GLB", () => {
    for (const url of Object.values(MODEL_URLS)) {
      expect(url.endsWith(".glb")).toBe(true);
      expect(url).toContain("/packages/assets/models/furniture/");
      expect(existsSync(fileURLToPath(url))).toBe(true);
    }
  });

  test("lobby kinds have models or placeholder heights", () => {
    for (const kind of [
      "reception_desk",
      "counter",
      "coffee_machine",
      "couch",
      "coffee_table",
      "plant",
    ] as const)
      expect(FURNITURE_MODELS[kind]?.targetHeight).toBeGreaterThan(0);
    expect(FURNITURE_MODELS.jukebox).toBeUndefined();
    for (const kind of OBSTACLE_KINDS) expect(PLACEHOLDER_HEIGHTS[kind]).toBeGreaterThan(0);
  });

  test("chairs go at desk and reception seats, not on couches", () => {
    expect(chairForSeat("desk")).toBe(CHAIR_MODEL);
    expect(chairForSeat("reception")).toBe(CHAIR_MODEL);
    expect(chairForSeat("chair")).toBe(CHAIR_MODEL);
    expect(chairForSeat("couch")).toBeNull();
    expect(TV_MODEL.uniform).toBe(true);
  });
});
