import { expect, test } from "bun:test";
import { triangleCount } from "../geometry/builder.ts";
import { boardFrame, clipboardBody, gongChains, gongStand } from "./LairLooks.tsx";

test("each Look's static parts bake into one small vertex-coloured mesh", () => {
  for (const geo of [
    boardFrame(1.8, 1.1),
    clipboardBody(0.5, 0.7),
    gongStand(0.56, 1.2, 1.4),
    gongChains(0.56, 1.2),
  ]) {
    expect(geo.getAttribute("color").count).toBe(geo.getAttribute("position").count);
    expect(triangleCount(geo)).toBeGreaterThan(10);
    expect(triangleCount(geo)).toBeLessThan(400);
    for (const v of geo.getAttribute("position").array as Float32Array)
      expect(Number.isFinite(v)).toBe(true);
  }
});
