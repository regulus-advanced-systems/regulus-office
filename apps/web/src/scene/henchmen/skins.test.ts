/** Henchman skins (#184): every built-in skin builds, is skinned soundly, stays in budget and takes the provider trim. */
import { describe, expect, test } from "bun:test";
import { HENCHMAN_SKIN_IDS } from "@regulus/protocol";
import { PROVIDER_LIGHT_COLORS } from "../avatar/colorSets.ts";
import {
  henchmanMaterial,
  henchmanMaterialCount,
  SLOT_COUNT,
  STANDARD_PALETTE,
} from "./palette.ts";
import { BONE_NAMES } from "./rig.ts";
import { triangleCount } from "./shapes.ts";
import { lightAt, paletteFor, SKIN_LOOKS, skinGeometry, skinLook } from "./skins.ts";

/** SPEC §11: 20 on screen at 60 fps on an iGPU; robot.glb was 3237 triangles in 16 meshes. */
const TRIANGLE_BUDGET = 5000;

describe("henchman skins", () => {
  test("every skin id has a look, and unknown ids wear the standard jumpsuit", () => {
    for (const id of HENCHMAN_SKIN_IDS) expect(SKIN_LOOKS[id]).toBeDefined();
    expect(skinLook("pirate")).toBe(SKIN_LOOKS.standard);
    expect(skinLook(undefined)).toBe(SKIN_LOOKS.standard);
    expect(SKIN_LOOKS.standard.palette.suit).toBe("#F2C200");
    // The special skins differ from the jumpsuit and from each other.
    const looks = HENCHMAN_SKIN_IDS.map((id) => {
      const l = SKIN_LOOKS[id];
      return `${l.palette.suit}/${l.headwear}/${l.outfit}`;
    });
    expect(new Set(looks).size).toBe(HENCHMAN_SKIN_IDS.length);
  });

  for (const id of HENCHMAN_SKIN_IDS)
    test(`${id}: one skinned geometry within budget, weights summing to 1, uvs on palette slots`, () => {
      const g = skinGeometry(id);
      expect(skinGeometry(id)).toBe(g);
      expect(triangleCount(g)).toBeLessThan(TRIANGLE_BUDGET);
      const index = g.attributes.skinIndex;
      const weight = g.attributes.skinWeight;
      const uv = g.attributes.uv;
      if (!index || !weight || !uv) throw new Error("not skinned");
      let weightError = 0;
      let slotError = 0;
      let maxBone = 0;
      for (let i = 0; i < weight.count; i++) {
        const sum = weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i);
        weightError = Math.max(weightError, Math.abs(sum - 1));
        for (const k of [0, 1, 2, 3]) maxBone = Math.max(maxBone, index.getComponent(i, k));
        const slot = uv.getX(i) * SLOT_COUNT - 0.5;
        slotError = Math.max(slotError, Math.abs(slot - Math.round(slot)));
      }
      expect(weightError).toBeLessThan(1e-5);
      expect(slotError).toBeLessThan(1e-4);
      expect(maxBone).toBeLessThan(BONE_NAMES.length);
      // The status light sits on top, above the head.
      expect(lightAt(id)[1]).toBeGreaterThan(1.55);
    });

  test("the provider colour is the trim; materials are shared per skin and trim", () => {
    expect(paletteFor("standard", PROVIDER_LIGHT_COLORS.codex).trim).toBe(
      PROVIDER_LIGHT_COLORS.codex,
    );
    expect(paletteFor("standard", undefined)).toBe(STANDARD_PALETTE);
    expect(paletteFor("chef", "#123456")).toMatchObject({
      trim: "#123456",
      suit: SKIN_LOOKS.chef.palette.suit,
    });
    const before = henchmanMaterialCount();
    const a = henchmanMaterial(paletteFor("standard", PROVIDER_LIGHT_COLORS.codex));
    const b = henchmanMaterial(paletteFor("standard", PROVIDER_LIGHT_COLORS.codex));
    const c = henchmanMaterial(paletteFor("standard", PROVIDER_LIGHT_COLORS["claude-code"]));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(henchmanMaterialCount()).toBe(before + 2);
  });

  test("the palette texture holds the colours as sRGB bytes", () => {
    const m = henchmanMaterial(paletteFor("standard", "#D97757"));
    const data = (m.map?.image as { data: Uint8Array }).data;
    // Slot 0 is the suit (#F2C200), slot 4 the trim (#D97757).
    expect(Array.from(data.slice(0, 3))).toEqual([0xf2, 0xc2, 0x00]);
    expect(Array.from(data.slice(16, 19))).toEqual([0xd9, 0x77, 0x57]);
  });
});
