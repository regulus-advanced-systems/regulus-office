/**
 * The secretary form (#281): built on the crew's rig, dressed for the office
 * (jacket to the collar, a mini skirt to mid-thigh over sheer tights), glasses on, hair up, and a
 * clipboard that sits in her left arm against the chest in every clip.
 */
import { describe, expect, test } from "bun:test";
import { AVATAR_ANIMATIONS } from "@regulus/protocol";
import { AnimationMixer, type BufferGeometry, Vector3 } from "three";
import { ARM_OVERLAY_WEIGHT, HENCHMAN_CLIPS, henchmanClip, henchmanClips } from "./clips.ts";
import { buildHenchman } from "./instance.ts";
import { SLOT_COUNT, SLOTS, type Slot } from "./palette.ts";
import { skinMatrix } from "./posed.ts";
import { HOLD_CLIPBOARD, STAND } from "./poses.ts";
import { BONE_INDEX, type BoneName, bindPosition } from "./rig.ts";
import { secretaryParts } from "./secretary.ts";
import { paletteFor, SKIN_LOOKS, skinGeometry } from "./skins.ts";
import { crewVariant, SKIN_TONES } from "./variety.ts";

const g = skinGeometry("secretary");

/** Bind-pose vertices with their slot, bones and weights. */
function vertices(geometry: BufferGeometry) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const index = geometry.attributes.skinIndex;
  const weight = geometry.attributes.skinWeight;
  if (!pos || !uv || !index || !weight) throw new Error("not skinned");
  return Array.from({ length: pos.count }, (_, i) => {
    const weights = new Map<number, number>();
    for (const k of [0, 1, 2, 3]) {
      const w = weight.getComponent(i, k);
      if (w > 0)
        weights.set(index.getComponent(i, k), (weights.get(index.getComponent(i, k)) ?? 0) + w);
    }
    return {
      i,
      p: new Vector3().fromBufferAttribute(pos, i),
      slot: SLOTS[Math.round(uv.getX(i) * SLOT_COUNT - 0.5)] as Slot,
      weights,
      on: (bone: BoneName) => weights.get(BONE_INDEX[bone]) ?? 0,
    };
  });
}

const verts = vertices(g);
const HEAD_BONES: BoneName[] = ["Head", "Neck"];
const HAND_BONES: BoneName[] = ["HandL", "HandR"];

function play(base: string, hold = true, at = 0.3) {
  const h = buildHenchman("secretary");
  const mixer = new AnimationMixer(h.group);
  const clip = (name: string) => {
    const c = henchmanClips().find((x) => x.name === name);
    if (!c) throw new Error(name);
    return c;
  };
  mixer.clipAction(clip(base)).play();
  if (hold) {
    const a = mixer.clipAction(clip(HENCHMAN_CLIPS.hold));
    a.weight = ARM_OVERLAY_WEIGHT;
    a.play();
  }
  mixer.update(at);
  h.group.updateMatrixWorld(true);
  const at3 = (i: number) =>
    h.mesh.getVertexPosition(i, new Vector3()).applyMatrix4(h.mesh.matrixWorld);
  return { h, at3 };
}

describe("the secretary", () => {
  test("is a form of her own that carries something, not a henchman skin's outfit", () => {
    expect(SKIN_LOOKS.secretary.body).toBe("secretary");
    expect(SKIN_LOOKS.secretary.holds).toBe(true);
    expect(SKIN_LOOKS.secretary.head).toBe("updo");
    for (const [id, look] of Object.entries(SKIN_LOOKS))
      if (id !== "secretary") expect([id, look.holds]).toEqual([id, false]);
  });

  test("dressed for the office: bare skin only at the head, neck and hands; the legs are in tights", () => {
    const bare = verts.filter((v) => v.slot === "skin" || v.slot === "skinShade");
    expect(bare.length).toBeGreaterThan(50);
    for (const v of bare) {
      const where = [...HEAD_BONES, ...HAND_BONES].reduce((s, b) => s + v.on(b), 0);
      expect(where).toBeCloseTo(1, 5);
    }
    // The legs are their own slot (sheer tights), which takes her skin tone, shoes stay dark.
    const legs = verts.filter((v) => v.on("LowerLegL") + v.on("UpperLegL") > 0.9);
    expect(new Set(legs.map((v) => v.slot))).toEqual(new Set(["pants"]));
    expect(SKIN_LOOKS.secretary.sheerLegs).toBe(true);
    for (const seed of ["moneypenny", "tilly", "shim"]) {
      const v = crewVariant(seed);
      const p = paletteFor("secretary", undefined, v);
      expect(p.pants).toBe(SKIN_TONES[v.tone]?.skin as string);
      expect(p.boots).toBe(SKIN_LOOKS.secretary.palette.boots);
    }
    expect(paletteFor("secretary", undefined).pants).toBe(SKIN_LOOKS.secretary.palette.skin);
    expect(paletteFor("standard", undefined, crewVariant("shim")).pants).toBe("#F2C200");
    // The jacket closes at the collar: suit or blouse right up to the neck's base.
    const torso = verts.filter(
      (v) => v.on("Body") > 0.5 && (v.slot === "suit" || v.slot === "shirt"),
    );
    expect(Math.max(...torso.map((v) => v.p.y))).toBeGreaterThan(bindPosition("Neck").y);
  });

  test("a mini skirt: from the waist to mid-thigh, all the way round, well clear of the hip", () => {
    const skirt = verts.filter((v) => v.slot === "suitDark" && v.p.y < 0.97);
    const knee = bindPosition("LowerLegL").y;
    const hip = bindPosition("UpperLegL").y;
    const hem = Math.min(...skirt.map((v) => v.p.y));
    // Mid-thigh: between a third and a half of the thigh is covered.
    expect((hip - hem) / (hip - knee)).toBeGreaterThan(0.33);
    expect((hip - hem) / (hip - knee)).toBeLessThan(0.5);
    // And it ends well below the hip joint and the bottom of the torso under it.
    expect(hem).toBeLessThan(hip - 0.12);
    const torsoBottom = Math.min(...verts.filter((v) => v.slot === "suit").map((v) => v.p.y));
    expect(hem).toBeLessThan(torsoBottom - 0.08);
    expect(Math.max(...skirt.map((v) => v.p.y))).toBeGreaterThan(hip + 0.05);
    // A closed tube: at the hem there are vertices in front, behind and on both sides.
    const rim = skirt.filter((v) => v.p.y < hem + 0.01);
    for (const pick of [
      (v: Vector3) => v.z,
      (v: Vector3) => -v.z,
      (v: Vector3) => v.x,
      (v: Vector3) => -v.x,
    ])
      expect(Math.max(...rim.map((v) => pick(v.p)))).toBeGreaterThan(0.09);
    // Wider than the legs under it at the hem.
    const thighs = verts.filter((v) => v.on("UpperLegL") > 0.9 && v.slot === "pants");
    expect(Math.max(...rim.map((v) => v.p.x))).toBeGreaterThan(
      Math.max(...thighs.map((v) => v.p.x)),
    );
  });

  test("the skirt hangs from the hips and each side follows its own leg", () => {
    const skirt = verts.filter((v) => v.slot === "suitDark" && v.p.y < 0.97);
    const hem = Math.min(...skirt.map((v) => v.p.y));
    for (const v of skirt) {
      if (v.p.y > 0.94) expect(v.on("Hips")).toBeGreaterThan(0.85);
      if (v.p.y < hem + 0.01 && v.p.x > 0.06) expect(v.on("UpperLegL")).toBeGreaterThan(0.6);
      if (v.p.y < hem + 0.01 && v.p.x < -0.06) expect(v.on("UpperLegR")).toBeGreaterThan(0.6);
      expect(v.on("Hips")).toBeGreaterThan(0.15);
    }
    // Mid-stride the hem still wraps both thighs: no thigh vertex pokes out in front of or behind it.
    for (const at of [0.01, 0.23, 0.46, 0.68]) {
      const { at3 } = play(HENCHMAN_CLIPS.walk, true, at);
      const rim = skirt.filter((v) => v.p.y < hem + 0.05).map((v) => at3(v.i));
      const front = Math.max(...rim.map((p) => p.z));
      const back = Math.min(...rim.map((p) => p.z));
      const rimY = Math.min(...rim.map((p) => p.y));
      const inside = verts
        .filter((v) => v.slot === "pants" && v.on("UpperLegL") + v.on("UpperLegR") > 0.9)
        .map((v) => at3(v.i))
        .filter((p) => p.y > rimY + 0.08);
      for (const p of inside) {
        expect(p.z).toBeLessThan(front + 0.03);
        expect(p.z).toBeGreaterThan(back - 0.03);
      }
    }
  });

  test("glasses on the face, hair up, a neck bow in the provider colour", () => {
    const frames = verts.filter((v) => v.slot === "ink" && v.on("Head") === 1 && v.p.z > 0.08);
    expect(frames.length).toBeGreaterThan(80);
    const hair = verts.filter((v) => v.slot === "hair" && v.on("Head") === 1);
    // The bun sits above the crown.
    expect(Math.max(...hair.map((v) => v.p.y))).toBeGreaterThan(1.74);
    const trim = verts.filter((v) => v.slot === "trim");
    expect(trim.some((v) => v.on("Body") === 1 && v.p.y > 1.36 && v.p.z > 0.06)).toBe(true);
  });

  test("the clipboard is modelled where she holds it: against the chest, in the left forearm", () => {
    const board = verts.filter(
      (v) => v.on("LowerArmL") === 1 && ["belt", "white", "metal"].includes(v.slot),
    );
    expect(board.length).toBeGreaterThanOrEqual(24);
    const papers = verts.filter((v) => v.on("LowerArmL") === 1 && v.slot === "white");
    expect(papers.length).toBeGreaterThanOrEqual(8);
    // Posed exactly (no blend): the bind-pose vertices land in front of the chest.
    const m = skinMatrix({ ...STAND, ...HOLD_CLIPBOARD }, "LowerArmL");
    const held = board.map((v) => v.p.clone().applyMatrix4(m));
    const centre = held.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / held.length);
    expect(centre.x).toBeGreaterThan(0);
    expect(centre.x).toBeLessThan(0.14);
    expect(centre.y).toBeGreaterThan(1.1);
    expect(centre.y).toBeLessThan(1.32);
    for (const p of held) {
      // In front of the jacket, below the chin, above the belt.
      expect(p.z).toBeGreaterThan(0.085);
      expect(p.z).toBeLessThan(0.3);
      expect(p.y).toBeLessThan(1.4);
      expect(p.y).toBeGreaterThan(1.02);
    }
    // And the left hand is at the board, not hanging at her side.
    const hand = bindPosition("HandL").applyMatrix4(
      skinMatrix({ ...STAND, ...HOLD_CLIPBOARD }, "HandL"),
    );
    expect(hand.distanceTo(centre)).toBeLessThan(0.16);
  });

  test("she keeps hold of it standing, walking and at a desk; the right hand stays free", () => {
    const board = verts.filter((v) => v.on("LowerArmL") === 1 && v.slot === "belt");
    for (const animation of AVATAR_ANIMATIONS)
      for (const seated of [false, true]) {
        const clip = henchmanClip(animation, seated);
        if (clip === HENCHMAN_CLIPS.sitCheer) continue;
        const { h, at3 } = play(clip, true, 0.4);
        const chest = h.mesh.skeleton.bones[BONE_INDEX.Body]?.getWorldPosition(new Vector3());
        const centre = board
          .map((v) => at3(v.i))
          .reduce((s, p) => s.add(p), new Vector3())
          .multiplyScalar(1 / board.length);
        // Within a forearm's length of the chest bone whatever the rest of her does.
        expect([clip, centre.distanceTo(chest ?? new Vector3()) < 0.3]).toEqual([clip, true]);
      }
    // Without the overlay the arm (and the board) would hang at her side.
    const loose = play(HENCHMAN_CLIPS.idle, false);
    const held = play(HENCHMAN_CLIPS.idle, true);
    const y = (r: ReturnType<typeof play>) =>
      board.map((v) => r.at3(v.i).y).reduce((s, v) => s + v, 0) / board.length;
    expect(y(held)).toBeGreaterThan(y(loose) + 0.15);
  });

  test("stays within the budget the crew has", () => {
    expect(secretaryParts().length).toBeGreaterThan(30);
    expect((g.index?.count ?? 0) / 3).toBeLessThan(4000);
  });
});
