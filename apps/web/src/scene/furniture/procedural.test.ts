import { describe, expect, test } from "bun:test";
import { CylinderGeometry, Euler, Vector3 } from "three";
import { JUKEBOX_ARCH_START } from "./Procedural.tsx";

describe("jukebox arch (#143)", () => {
  test("the half cylinder stands up over the body, not on its side", () => {
    const geo = new CylinderGeometry(0.4, 0.4, 0.6, 24, 1, false, JUKEBOX_ARCH_START, Math.PI);
    const pos = geo.getAttribute("position");
    const turn = new Euler(Math.PI / 2, 0, 0);
    const v = new Vector3();
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyEuler(turn);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
    }
    expect(minY).toBeGreaterThan(-1e-6);
    expect(maxY).toBeCloseTo(0.4, 6);
    // Spans the full body width, symmetric about the centre.
    expect(minX).toBeCloseTo(-0.4, 6);
    expect(maxX).toBeCloseTo(0.4, 6);
  });
});
