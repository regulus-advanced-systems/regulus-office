import { expect, test } from "bun:test";
import { getGradientMap } from "../avatar/toonMaterial.ts";
import { HENCHMAN_YELLOW, STANDARD_PALETTE } from "../henchmen/palette.ts";
import { createLairMaterials, disposeLairMaterials } from "./materials.ts";
import { LAIR } from "./palette.ts";

test("the lair shades on the henchmen's toon ramp, so rooms and characters match (#184)", () => {
  const m = createLairMaterials();
  expect(m.body.gradientMap).toBe(getGradientMap());
  expect(m.cutBody.gradientMap).toBe(getGradientMap());
  expect(m.body.vertexColors).toBe(true);
  disposeLairMaterials(m);
  // The shared ramp survives a scene's materials being disposed.
  expect(getGradientMap().image).toBeDefined();
});

test("the lair's accents are the henchmen's (SPEC §12)", () => {
  expect(LAIR.yellow).toBe(HENCHMAN_YELLOW);
  expect(LAIR.red).toBe(STANDARD_PALETTE.accent);
  expect(LAIR.brass).toBe(STANDARD_PALETTE.metal);
});
