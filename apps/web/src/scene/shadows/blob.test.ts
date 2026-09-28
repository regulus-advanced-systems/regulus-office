import { describe, expect, test } from "bun:test";
import {
  BLOB_OFFSET,
  BLOB_OPACITY,
  BLOB_SPREAD,
  BLOB_Y,
  blobPixels,
  blobPlacement,
  createBlobTexture,
  sharedBlobTexture,
} from "./blob.ts";

describe("blobPixels", () => {
  test("white, opaque in the middle, transparent at the edge, monotone in between", () => {
    const size = 32;
    const px = blobPixels(size);
    expect(px.length).toBe(size * size * 4);
    const alpha = (x: number, y: number) => px[(y * size + x) * 4 + 3] as number;
    expect(px[0]).toBe(255);
    expect(alpha(16, 16)).toBe(255);
    expect(alpha(0, 0)).toBeLessThan(4);
    expect(alpha(0, 16)).toBeLessThan(4);
    let prev = alpha(16, 16);
    for (let x = 16; x < size; x++) {
      expect(alpha(x, 16)).toBeLessThanOrEqual(prev);
      prev = alpha(x, 16);
    }
  });

  test("is symmetric", () => {
    const size = 16;
    const px = blobPixels(size);
    const alpha = (x: number, y: number) => px[(y * size + x) * 4 + 3];
    expect(alpha(3, 5)).toBe(alpha(12, 10));
    expect(alpha(3, 5)).toBe(alpha(5, 3));
  });
});

describe("textures", () => {
  test("createBlobTexture sizes the image and sharedBlobTexture is a singleton", () => {
    const tex = createBlobTexture(8);
    expect(tex.image.width).toBe(8);
    expect(tex.version).toBeGreaterThan(0);
    expect(sharedBlobTexture()).toBe(sharedBlobTexture());
  });
});

describe("blobPlacement", () => {
  test("grows the footprint and nudges it toward +x/+z just above the floor", () => {
    const p = blobPlacement({ x: 2, z: 6.5, w: 0.9, d: 2 });
    expect(p.position[0]).toBeCloseTo(2.45 + BLOB_OFFSET, 9);
    expect(p.position[1]).toBe(BLOB_Y);
    expect(p.position[2]).toBeCloseTo(7.5 + BLOB_OFFSET, 9);
    expect(p.width).toBeCloseTo(0.9 + 2 * BLOB_SPREAD, 9);
    expect(p.depth).toBeCloseTo(2 + 2 * BLOB_SPREAD, 9);
  });

  test("shadows are soft, not hard black", () => {
    expect(BLOB_OPACITY).toBeGreaterThan(0.3);
    expect(BLOB_OPACITY).toBeLessThan(0.8);
  });
});
