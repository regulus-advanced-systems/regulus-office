/**
 * The scientist: lanky and stooped, a huge bald dome with wild tufts of hair
 * blown sideways, a long lab coat with tails, rubber gloves. Accessories:
 * brass-rimmed goggles, a bubbling flask, a bow tie.
 */
import { SLOT } from "../palette.ts";
import type { PartBuilder } from "../parts.ts";
import { type Body, restJoints } from "../rig.ts";
import { FOOT_HEIGHT, face, headFrame, limbs, neck, onHead, skull } from "./common.ts";
import type { ArchetypeModel } from "./types.ts";

const body: Body = {
  hipY: 0.44 + 0.42 + FOOT_HEIGHT,
  hipX: 0.11,
  thigh: 0.44,
  shin: 0.42,
  waist: 0.12,
  torso: 0.46,
  shoulderY: 0.4,
  shoulderX: 0.25,
  upperArm: 0.32,
  foreArm: 0.3,
  head: 0.46,
  backDepth: 0.14,
  seatDrop: 0.12,
  height: 2.16,
};

const head = headFrame(body, 0.05, [1, 1, 0.95]);
const j = restJoints(body);
const spineY = j.spine[1];
const neckY = j.head[1];

function build(p: PartBuilder): void {
  // Coat, shirt and trousers.
  p.box("hips", SLOT.outfitDark, [0.32, 0.18, 0.22], [0, body.hipY + 0.03, 0]);
  p.box("spine", SLOT.outfit, [0.44, 0.5, 0.28], [0, spineY + 0.22, 0], { taper: [1.12, 1] });
  p.box("spine", SLOT.trim, [0.12, 0.3, 0.02], [0, spineY + 0.31, 0.145], { taper: [1.6, 1] });
  p.box("spine", SLOT.black, [0.04, 0.2, 0.02], [0, spineY + 0.3, 0.155], { taper: [1.4, 1] });
  p.mirror((side) => {
    p.box("spine", SLOT.outfit, [0.08, 0.32, 0.03], [side * 0.095, spineY + 0.3, 0.15], {
      rot: [0, 0, side * 0.3],
    });
    p.box("hips", SLOT.outfit, [0.06, 0.46, 0.25], [side * 0.22, body.hipY - 0.13, -0.01], {
      taper: [0.8, 0.9],
    });
    p.box(
      side === 1 ? "thighL" : "thighR",
      SLOT.outfit,
      [0.17, 0.5, 0.07],
      [side * (body.hipX + 0.03), body.hipY - 0.18, 0.1],
    );
  });
  p.box("hips", SLOT.outfit, [0.46, 0.54, 0.08], [0, body.hipY - 0.16, -0.12], {
    taper: [0.9, 1],
    shear: [0, 0.03],
  });
  // Pens in the breast pocket.
  p.box("spine", SLOT.silver, [0.022, 0.08, 0.02], [0.13, spineY + 0.34, 0.15]);
  p.box("spine", SLOT.lipstick, [0.022, 0.07, 0.02], [0.16, spineY + 0.335, 0.15]);
  limbs(p, body, {
    sleeve: SLOT.outfit,
    hand: SLOT.trim,
    thigh: SLOT.outfitDark,
    shin: SLOT.outfitDark,
    shoe: SLOT.black,
    armW: 0.12,
    legW: 0.13,
    handSize: 0.15,
  });
  // Head: domed and bald on top, wild tufts at the sides and back.
  neck(p, body, 0.065);
  skull(p, head, [1.1, 1.04]);
  p.ball("head", SLOT.skin, [0.26, 0.15, 0.24], onHead(head, 0, head.hy - 0.01, -0.01), {
    detail: 1,
  });
  p.mirror((side) => {
    for (const [dy, dz, len, r] of [
      [0.06, -0.02, 0.24, 0.09],
      [-0.06, -0.06, 0.2, 0.08],
      [0.14, -0.1, 0.16, 0.07],
    ] as const) {
      p.cone("head", SLOT.hair, r, len, onHead(head, side * (head.hx + len * 0.35), dy, dz), {
        rot: [0.2, 0, -side * (1.25 + dy)],
        sides: 5,
      });
    }
  });
  p.cone("head", SLOT.hair, 0.1, 0.22, onHead(head, 0, 0.02, -head.hz - 0.06), {
    rot: [-1.4, 0, 0],
    sides: 5,
  });
  face(p, head, {
    browSize: [0.15, 0.05, 0.05],
    nose: [0.085, 0.15, 0.13],
    smirk: 0.22,
    browSlant: 0.22,
  });
}

function accessory(p: PartBuilder, id: string): void {
  if (id === "goggles") {
    p.box(
      "head",
      SLOT.black,
      [head.hx * 2 + 0.03, 0.05, head.hz * 2 + 0.03],
      onHead(head, 0, head.hy * 0.62, 0),
    );
    p.mirror((side) => {
      const at = onHead(head, side * 0.1, head.hy * 0.66, head.hz + 0.035);
      p.cyl("head", SLOT.gold, 0.075, 0.075, 0.07, at, { rot: [Math.PI / 2, 0, 0], sides: 8 });
      p.cyl("head", SLOT.glow, 0.055, 0.055, 0.02, [at[0], at[1], at[2] + 0.03], {
        rot: [Math.PI / 2, 0, 0],
        sides: 8,
      });
    });
  } else if (id === "flask") {
    const handY = j.armR[1] - body.upperArm - body.foreArm - 0.07;
    const x = -body.shoulderX + 0.02;
    p.cone("foreR", SLOT.potion, 0.1, 0.17, [x, handY, 0.11], { sides: 7 });
    p.cyl("foreR", SLOT.pearl, 0.028, 0.028, 0.1, [x, handY + 0.12, 0.11], { sides: 6 });
    p.ball("foreR", SLOT.potion, 0.035, [x + 0.02, handY + 0.22, 0.11]);
    p.ball("foreR", SLOT.potion, 0.025, [x - 0.01, handY + 0.29, 0.11]);
  } else if (id === "bowtie") {
    p.mirror((side) => {
      p.box("spine", SLOT.trim, [0.1, 0.09, 0.04], [side * 0.06, neckY - 0.04, 0.155], {
        taper: [1, 1],
        rot: [0, 0, side * 0.35],
      });
    });
    p.box("spine", SLOT.trim, [0.04, 0.05, 0.05], [0, neckY - 0.04, 0.16]);
  }
}

export const scientist: ArchetypeModel = {
  id: "scientist",
  body,
  style: { idle: "rub_hands", lean: 9, stride: 26, armSwing: 18, sway: 2, bob: 0.03 },
  build,
  accessory,
};
