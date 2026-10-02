/** The talking mouth (#48): on every archetype's face, following the head, hidden when quiet. */
import { describe, expect, test } from "bun:test";
import { accessoriesFor, DEFAULT_GENIUS_LOOK, GENIUS_ARCHETYPES } from "@regulus/protocol";
import { Vector3 } from "three";
import { ARCHETYPE_MODELS } from "./archetypes.ts";
import { createGenius } from "./model.ts";
import { attachMouth, MOUTH_OPEN_HEIGHT, mouthOpening } from "./mouth.ts";
import { boneNodeName } from "./rig.ts";

describe("talking mouth", () => {
  for (const archetype of GENIUS_ARCHETYPES) {
    test(`${archetype}: on the front of the face, on the head bone`, () => {
      const model = ARCHETYPE_MODELS[archetype];
      const genius = createGenius({
        ...DEFAULT_GENIUS_LOOK,
        archetype,
        accessory: accessoriesFor(archetype)[0] ?? "none",
      });
      const mouth = attachMouth(genius.bones, model);
      if (!mouth) throw new Error("no head bone");
      expect(mouth.mesh.parent?.name).toBe(boneNodeName("head"));
      expect(mouth.mesh.visible).toBe(false);
      genius.root.updateMatrixWorld(true);
      // In model space (the skinned mesh's frame, before the root's MODEL_YAW).
      const at = genius.mesh.worldToLocal(mouth.mesh.getWorldPosition(new Vector3()));
      const h = model.head;
      expect(at.y).toBeLessThan(h.c[1]);
      expect(at.y).toBeGreaterThan(h.c[1] - h.hy);
      expect(at.z).toBeGreaterThan(h.c[2] + h.hz);
      mouth.set(1);
      expect(mouth.mesh.visible).toBe(true);
      expect(mouth.mesh.scale.y).toBeCloseTo(MOUTH_OPEN_HEIGHT);
      mouth.set(0);
      expect(mouth.mesh.visible).toBe(false);
      mouth.dispose();
      expect(mouth.mesh.parent).toBeNull();
    });
  }

  test("moves only while speaking, more with a louder voice", () => {
    expect(mouthOpening(0, 1)).toBe(0);
    const samples = (level: number) =>
      Array.from({ length: 200 }, (_, i) => mouthOpening(level, i / 60));
    const quiet = samples(0.05);
    const loud = samples(0.6);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(loud)).toBeGreaterThan(avg(quiet));
    expect(Math.max(...loud)).toBeLessThanOrEqual(1);
    // It opens and closes (not a fixed gape).
    expect(Math.max(...loud) - Math.min(...loud)).toBeGreaterThan(0.3);
  });
});
