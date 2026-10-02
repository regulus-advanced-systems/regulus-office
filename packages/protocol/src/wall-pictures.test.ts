import { describe, expect, test } from "bun:test";
import { OPERATION_ACCESSES } from "./enums.ts";
import {
  clampPictureSize,
  defaultPictureSize,
  mayEditPicture,
  mayPlacePicture,
  WALL_PICTURE_LIMITS,
  wallPictureImagePath,
  wallPicturesApiPath,
} from "./wall-pictures.ts";

const { minSize, maxSize } = WALL_PICTURE_LIMITS;

describe("wall pictures (#46)", () => {
  test("spawn and manage hang pictures; view and none do not", () => {
    expect(OPERATION_ACCESSES.filter(mayPlacePicture)).toEqual(["manage", "spawn"]);
    expect(mayPlacePicture(null)).toBe(false);
  });

  test("the placer and managers edit; nobody else", () => {
    expect(mayEditPicture("manage", "u2", "u1")).toBe(true);
    expect(mayEditPicture("spawn", "u1", "u1")).toBe(true);
    expect(mayEditPicture("spawn", "u2", "u1")).toBe(false);
    // A placer downgraded to view only looks.
    expect(mayEditPicture("view", "u1", "u1")).toBe(false);
    expect(mayEditPicture(null, "u1", "u1")).toBe(false);
    // A picture whose placer was deleted is for managers only.
    expect(mayEditPicture("spawn", "", "")).toBe(false);
  });

  test("clampPictureSize keeps the aspect inside the limits", () => {
    expect(clampPictureSize(0.8, 0.6)).toEqual({ w: 0.8, h: 0.6 });
    const big = clampPictureSize(4, 2);
    expect(big.w).toBeCloseTo(maxSize);
    expect(big.h).toBeCloseTo(1);
    const tiny = clampPictureSize(0.1, 0.2);
    expect(tiny.w).toBeCloseTo(minSize);
    expect(tiny.h).toBeCloseTo(0.6);
    // A panorama cannot keep its aspect: the long side wins.
    const pano = clampPictureSize(10, 1);
    expect(pano).toEqual({ w: maxSize, h: minSize });
    expect(clampPictureSize(0, 1)).toEqual({ w: minSize, h: minSize });
    expect(clampPictureSize(Number.NaN, 1)).toEqual({ w: minSize, h: minSize });
  });

  test("a new picture's longest side is the default size", () => {
    const s = defaultPictureSize(1600, 1200);
    expect(s.w).toBeCloseTo(WALL_PICTURE_LIMITS.defaultSize);
    expect(s.h).toBeCloseTo(0.675);
    const portrait = defaultPictureSize(600, 1200);
    expect(portrait.h).toBeCloseTo(WALL_PICTURE_LIMITS.defaultSize);
  });

  test("REST paths encode their ids", () => {
    expect(wallPicturesApiPath("op 1")).toBe("/api/operations/op%201/pictures");
    expect(wallPictureImagePath("o", "d/1")).toBe("/api/operations/o/pictures/d%2F1");
  });
});
