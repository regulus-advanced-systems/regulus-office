/**
 * Henchman skins and forms (#184, #281): every built-in form builds, is skinned
 * soundly, stays in budget, takes the provider trim and the wearer's tone and
 * hair, and has the slim, bare-headed proportions the restyle asks for.
 */
import { describe, expect, test } from "bun:test";
import { CHARACTER_FORM_IDS, HENCHMAN_SKIN_IDS } from "@regulus/protocol";
import type { BufferGeometry } from "three";
import { PROVIDER_LIGHT_COLORS } from "../avatar/colorSets.ts";
import {
  henchmanMaterial,
  henchmanMaterialCount,
  SLOT_COUNT,
  SLOTS,
  STANDARD_PALETTE,
} from "./palette.ts";
import { BONE_INDEX, BONE_NAMES, bindPosition, HEAD_HEIGHT, HENCHMAN_HEIGHT } from "./rig.ts";
import { triangleCount } from "./shapes.ts";
import { hairOf, paletteFor, SKIN_LOOKS, skinGeometry, skinLook } from "./skins.ts";
import { crewVariant, HAIR_COLOURS, HAIR_STYLES, SKIN_TONES } from "./variety.ts";

/** SPEC §11: 20 on screen at 60 fps on an iGPU. The dome-hat henchmen of #184 were about 4,400 triangles each. */
const TRIANGLE_BUDGET = 4000;

/** Extent of the vertices mostly driven by `bones` (all of them without), per axis. */
function extent(g: BufferGeometry, bones?: readonly number[]) {
  const pos = g.attributes.position;
  const index = g.attributes.skinIndex;
  if (!pos || !index) throw new Error("not skinned");
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.count; i++) {
    if (bones && !bones.includes(index.getX(i))) continue;
    [pos.getX(i), pos.getY(i), pos.getZ(i)].forEach((v, k) => {
      lo[k] = Math.min(lo[k] as number, v);
      hi[k] = Math.max(hi[k] as number, v);
    });
  }
  return { lo, hi, size: hi.map((v, k) => v - (lo[k] as number)) };
}

/** Vertices painted in `slot`. */
function slotExtent(g: BufferGeometry, slot: (typeof SLOTS)[number]) {
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  if (!pos || !uv) throw new Error("no uv");
  const want = SLOTS.indexOf(slot);
  let n = 0;
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (Math.round(uv.getX(i) * SLOT_COUNT - 0.5) !== want) continue;
    n++;
    top = Math.max(top, pos.getY(i));
  }
  return { n, top };
}

describe("henchman skins", () => {
  test("every skin and form id has a look, and unknown ids wear the standard jumpsuit", () => {
    for (const id of CHARACTER_FORM_IDS) expect(SKIN_LOOKS[id]).toBeDefined();
    expect(skinLook("pirate")).toBe(SKIN_LOOKS.standard);
    expect(skinLook(undefined)).toBe(SKIN_LOOKS.standard);
    expect(skinLook("secretary")).toBe(SKIN_LOOKS.secretary);
    expect(SKIN_LOOKS.standard.palette.suit).toBe("#F2C200");
    // The forms differ from the jumpsuit and from each other.
    const looks = CHARACTER_FORM_IDS.map((id) => {
      const l = SKIN_LOOKS[id];
      return `${l.palette.suit}/${l.head}/${l.outfit}`;
    });
    expect(new Set(looks).size).toBe(CHARACTER_FORM_IDS.length);
  });

  for (const id of CHARACTER_FORM_IDS)
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

  test("every form shows the provider colour somewhere", () => {
    for (const id of CHARACTER_FORM_IDS)
      expect([id, slotExtent(skinGeometry(id), "trim").n > 20]).toEqual([id, true]);
  });

  test("the palette texture holds the colours as sRGB bytes", () => {
    const m = henchmanMaterial(paletteFor("standard", "#D97757"));
    const data = (m.map?.image as { data: Uint8Array }).data;
    // Slot 0 is the suit (#F2C200), slot 4 the trim (#D97757).
    expect(Array.from(data.slice(0, 3))).toEqual([0xf2, 0xc2, 0x00]);
    expect(Array.from(data.slice(16, 19))).toEqual([0xd9, 0x77, 0x57]);
  });
});

describe("the restyle (#281): slim, athletic, bare-headed", () => {
  const g = skinGeometry("standard");
  const all = extent(g);

  test("about seven heads tall, feet on the floor", () => {
    expect(all.lo[1] as number).toBeCloseTo(0, 2);
    expect(all.hi[1] as number).toBeCloseTo(HENCHMAN_HEIGHT, 1);
    const heads = (all.hi[1] as number) / HEAD_HEIGHT;
    expect(heads).toBeGreaterThan(6.5);
    expect(heads).toBeLessThan(7.5);
    // The head itself: chin to crown, and narrow.
    const head = extent(g, [BONE_INDEX.Head]);
    expect(head.size[1] as number).toBeGreaterThan(HEAD_HEIGHT - 0.03);
    expect(head.size[1] as number).toBeLessThan(HEAD_HEIGHT + 0.04);
    expect(head.size[0] as number).toBeLessThan(0.22);
  });

  test("long legs, shoulders wider than the hips, a slim torso", () => {
    const hip = bindPosition("UpperLegL").y;
    expect(hip / HENCHMAN_HEIGHT).toBeGreaterThan(0.49);
    expect(bindPosition("UpperArmL").x).toBeGreaterThan(bindPosition("UpperLegL").x * 2);
    const chest = extent(g, [BONE_INDEX.Body]);
    const hips = extent(g, [BONE_INDEX.Hips]);
    expect(chest.size[0] as number).toBeGreaterThan((hips.size[0] as number) * 1.2);
    // The dome-hat build was 0.50 m across the belly and 0.37 m deep.
    expect(hips.size[0] as number).toBeLessThan(0.34);
    expect(hips.size[2] as number).toBeLessThan(0.24);
    // Slim limbs: an upper arm and a thigh.
    expect(extent(g, [BONE_INDEX.UpperArmL]).size[2] as number).toBeLessThan(0.13);
    expect(extent(g, [BONE_INDEX.UpperLegL]).size[2] as number).toBeLessThan(0.15);
  });

  test("no hats: nothing on a standard head rises more than a few centimetres over the skull", () => {
    for (const hair of HAIR_STYLES) {
      const styled = skinGeometry("standard", { hair, tone: 0, hairColour: 0 });
      const top = extent(styled).hi[1] as number;
      expect([hair, top < HENCHMAN_HEIGHT + 0.02]).toEqual([hair, true]);
      // Hair or a bare crown, never a hat.
      expect([hair, slotExtent(styled, "hat").n]).toEqual([hair, 0]);
      expect([hair, triangleCount(styled) < TRIANGLE_BUDGET]).toEqual([hair, true]);
    }
    // Special skins keep close to the head too (the cook's cap, the watch cap, the bun).
    for (const id of CHARACTER_FORM_IDS)
      expect([id, (extent(skinGeometry(id)).hi[1] as number) < HENCHMAN_HEIGHT + 0.08]).toEqual([
        id,
        true,
      ]);
  });

  test("the standard jumpsuit has a dark belt, gloves and boots", () => {
    for (const slot of ["belt", "gloves", "boots"] as const) {
      expect(slotExtent(g, slot).n).toBeGreaterThan(20);
      const hex = Number.parseInt(STANDARD_PALETTE[slot].slice(1), 16);
      const luma = ((hex >> 16) & 255) * 0.3 + ((hex >> 8) & 255) * 0.59 + (hex & 255) * 0.11;
      expect([slot, luma < 90]).toEqual([slot, true]);
    }
    // Boots reach well up the shin.
    expect(slotExtent(g, "boots").top).toBeGreaterThan(0.24);
  });

  test("hair style shares geometry per style; tone and hair colour only change the palette", () => {
    const a = crewVariant("rivet");
    const b = { ...a, tone: (a.tone + 1) % SKIN_TONES.length, hairColour: a.hairColour + 1 };
    expect(skinGeometry("standard", a)).toBe(skinGeometry("standard", b));
    const other = HAIR_STYLES.find((h) => h !== a.hair) as (typeof HAIR_STYLES)[number];
    expect(skinGeometry("standard", { ...a, hair: other })).not.toBe(skinGeometry("standard", a));
    // A special skin has its own head: one geometry whoever wears it.
    expect(skinGeometry("black_ops", a)).toBe(skinGeometry("black_ops", { ...a, hair: other }));
    expect(hairOf("standard", a)).toBe(a.hair);
    expect(hairOf("black_ops", a)).toBeUndefined();

    const pa = paletteFor("standard", "#D97757", a);
    const pb = paletteFor("standard", "#D97757", b);
    expect(pa.skin).toBe(SKIN_TONES[a.tone]?.skin as string);
    expect(pa.hair).toBe(HAIR_COLOURS[a.hairColour] as string);
    expect(pb.skin).not.toBe(pa.skin);
    expect(pa.suit).toBe("#F2C200");
    expect(pa.trim).toBe("#D97757");
    // Same person, same material.
    expect(henchmanMaterial(pa)).toBe(henchmanMaterial(paletteFor("standard", "#D97757", a)));
  });

  test("a special skin keeps its own hair colour unless it says otherwise; bare hands take the skin tone", () => {
    const v = crewVariant("shim");
    expect(paletteFor("lab_coat", undefined, v).hair).toBe(SKIN_LOOKS.lab_coat.palette.hair);
    expect(paletteFor("number_two", undefined, v).hair).toBe(SKIN_LOOKS.number_two.palette.hair);
    expect(paletteFor("chef", undefined, v).hair).toBe(HAIR_COLOURS[v.hairColour] as string);
    for (const id of ["chef", "number_two", "secretary"] as const)
      expect(paletteFor(id, undefined, v).gloves).toBe(SKIN_TONES[v.tone]?.skin as string);
    expect(paletteFor("standard", undefined, v).gloves).toBe(STANDARD_PALETTE.gloves);
    for (const id of CHARACTER_FORM_IDS)
      expect(paletteFor(id, undefined, v).skin).toBe(SKIN_TONES[v.tone]?.skin as string);
  });

  test("admin skin rules still cover exactly the henchman skins", () => {
    expect(HENCHMAN_SKIN_IDS).not.toContain("secretary" as never);
    expect<number>(CHARACTER_FORM_IDS.length).toBe(HENCHMAN_SKIN_IDS.length + 1);
  });
});
