/**
 * The tycoon: a round barrel of a man on short legs, a waistcoat stretched
 * over the belly with a gold watch chain, bald with bushy side-whiskers.
 * Accessories: a tall top hat, a monocle on a chain, a fat cigar.
 */
import { SLOT } from "../palette.ts";
import type { PartBuilder } from "../parts.ts";
import { type Body, restJoints } from "../rig.ts";
import { FOOT_HEIGHT, face, headFrame, limbs, neck, onHead, skull } from "./common.ts";
import type { ArchetypeModel } from "./types.ts";

const body: Body = {
  hipY: 0.3 + 0.3 + FOOT_HEIGHT,
  hipX: 0.17,
  thigh: 0.3,
  shin: 0.3,
  waist: 0.12,
  torso: 0.66,
  shoulderY: 0.56,
  shoulderX: 0.42,
  upperArm: 0.3,
  foreArm: 0.28,
  head: 0.44,
  backDepth: 0.3,
  seatDrop: 0.12,
  height: 1.98,
};

const head = headFrame(body, 0.03, [1.05, 0.95, 1]);
const j = restJoints(body);
const spineY = j.spine[1];
const neckY = j.head[1];

function build(p: PartBuilder): void {
  // The belly: jacket round the back and sides, waistcoat over the front.
  p.box("hips", SLOT.outfitDark, [0.5, 0.2, 0.36], [0, body.hipY + 0.04, 0]);
  p.ball("spine", SLOT.outfit, [0.48, 0.46, 0.42], [0, spineY + 0.2, -0.02], { detail: 1 });
  p.ball("spine", SLOT.trim, [0.4, 0.42, 0.4], [0, spineY + 0.17, 0.04], { detail: 1 });
  // Jacket fronts over the waistcoat, open over the belly.
  p.mirror((side) => {
    p.box("spine", SLOT.outfit, [0.14, 0.5, 0.1], [side * 0.3, spineY + 0.26, 0.3], {
      rot: [-0.25, side * 0.6, side * 0.12],
    });
  });
  for (const [dy, dz] of [
    [0.34, 0.37],
    [0.2, 0.44],
    [0.06, 0.42],
  ] as const) {
    p.box("spine", SLOT.gold, [0.045, 0.045, 0.03], [0, spineY + dy, dz]);
  }
  // Watch chain from the middle button to the pocket.
  p.box("spine", SLOT.gold, [0.24, 0.02, 0.02], [0.12, spineY + 0.17, 0.42], {
    rot: [0, -0.5, -0.3],
  });
  p.box("spine", SLOT.outfit, [0.86, 0.2, 0.36], [0, spineY + 0.5, -0.04], { taper: [0.75, 0.9] });
  // Shirt collar and cravat.
  p.box("spine", SLOT.pearl, [0.24, 0.1, 0.22], [0, neckY - 0.02, 0.04]);
  p.box("spine", SLOT.outfitDark, [0.1, 0.12, 0.05], [0, neckY - 0.06, 0.17], { taper: [1.4, 1] });
  // Coat tails.
  p.box("hips", SLOT.outfit, [0.5, 0.36, 0.08], [0, body.hipY - 0.06, -0.24], {
    taper: [1.1, 1],
    shear: [0, 0.03],
  });
  limbs(p, body, {
    sleeve: SLOT.outfit,
    hand: SLOT.skin,
    thigh: SLOT.outfitDark,
    shin: SLOT.outfitDark,
    shoe: SLOT.black,
    armW: 0.17,
    legW: 0.2,
    handSize: 0.16,
    shoeLength: 0.32,
  });
  // Spats on the shoes, cuffs on the sleeves.
  p.mirror((side, b) => {
    p.box(
      b("shinL", "shinR"),
      SLOT.pearl,
      [0.22, 0.07, 0.24],
      [side * body.hipX, FOOT_HEIGHT + 0.03, 0.02],
    );
    p.box(
      b("foreL", "foreR"),
      SLOT.pearl,
      [0.17, 0.05, 0.17],
      [side * body.shoulderX, j.armL[1] - body.upperArm - body.foreArm + 0.02, 0],
    );
  });
  // Head: round jowls, bald pate, side-whiskers.
  neck(p, body, 0.12, 0.06);
  skull(p, head, [0.82, 0.9]);
  p.ball("head", SLOT.skin, [0.25, 0.12, 0.23], onHead(head, 0, -head.hy + 0.05, 0.02));
  p.ball("head", SLOT.skin, [0.2, 0.1, 0.19], onHead(head, 0, head.hy - 0.01, 0), { detail: 1 });
  p.mirror((side) => {
    p.box(
      "head",
      SLOT.hair,
      [0.08, 0.26, 0.2],
      onHead(head, side * (head.hx + 0.02), -0.07, -0.01),
      {
        taper: [0.7, 0.8],
        rot: [0, 0, -side * 0.12],
      },
    );
  });
  p.box(
    "head",
    SLOT.hair,
    [head.hx * 2 + 0.03, 0.12, 0.06],
    onHead(head, 0, 0.02, -head.hz - 0.01),
  );
  face(p, head, {
    nose: [0.1, 0.1, 0.12],
    smirk: -0.1,
    mouthWidth: 0.16,
    browSize: [0.13, 0.04, 0.04],
    browSlant: 0.18,
  });
}

function accessory(p: PartBuilder, id: string): void {
  if (id === "top_hat") {
    const top = head.c[1] + head.hy;
    p.cyl("head", SLOT.black, 0.28, 0.28, 0.025, [0, top + 0.01, 0], { sides: 10 });
    p.cyl("head", SLOT.black, 0.18, 0.17, 0.36, [0, top + 0.19, 0], { sides: 10 });
    p.cyl("head", SLOT.trim, 0.175, 0.175, 0.06, [0, top + 0.06, 0], { sides: 10 });
  } else if (id === "monocle") {
    const at = onHead(head, -0.09, 0.03, head.hz + 0.025);
    p.cyl("head", SLOT.gold, 0.06, 0.06, 0.02, at, { rot: [Math.PI / 2, 0, 0], sides: 8 });
    p.cyl("head", SLOT.glow, 0.045, 0.045, 0.022, [at[0], at[1], at[2] + 0.004], {
      rot: [Math.PI / 2, 0, 0],
      sides: 8,
    });
    p.box("spine", SLOT.gold, [0.015, 0.3, 0.015], [-0.12, neckY - 0.1, 0.3], {
      rot: [0.3, 0, 0.2],
    });
  } else if (id === "cigar") {
    const at = onHead(head, -0.07, -head.hy * 0.52, head.hz + 0.08);
    p.box("head", SLOT.mouth, [0.035, 0.035, 0.18], at, { rot: [0.25, 0.35, 0] });
    p.box(
      "head",
      SLOT.lipstick,
      [0.037, 0.037, 0.02],
      [at[0] - 0.03, at[1] - 0.02, at[2] + 0.085],
      {
        rot: [0.25, 0.35, 0],
      },
    );
  }
}

export const tycoon: ArchetypeModel = {
  id: "tycoon",
  body,
  head,
  style: { idle: "thumbs_in_vest", lean: -6, stride: 22, armSwing: 14, sway: 8, bob: 0.03 },
  build,
  accessory,
  extraHeight: (a) => (a === "top_hat" ? 0.38 : 0),
};
