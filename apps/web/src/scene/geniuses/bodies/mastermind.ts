/**
 * The mastermind: tall and imposing, a long double-breasted coat with sharp
 * shoulders, gloved hands, slicked-back hair with a widow's peak, a pointed
 * goatee and a thin smile. Accessories: a floor-length cape, an eyepatch, a
 * towering stand-up collar.
 */
import { SLOT } from "../palette.ts";
import type { PartBuilder } from "../parts.ts";
import { type Body, restJoints } from "../rig.ts";
import { FOOT_HEIGHT, face, headFrame, limbs, neck, onHead, skull } from "./common.ts";
import type { ArchetypeModel } from "./types.ts";

const body: Body = {
  hipY: 0.46 + 0.44 + FOOT_HEIGHT,
  hipX: 0.12,
  thigh: 0.46,
  shin: 0.44,
  waist: 0.12,
  torso: 0.58,
  shoulderY: 0.52,
  shoulderX: 0.36,
  upperArm: 0.36,
  foreArm: 0.32,
  head: 0.44,
  backDepth: 0.17,
  seatDrop: 0.12,
  height: 2.32,
};

const head = headFrame(body, 0.05, [0.92, 1.12, 0.95]);
const j = restJoints(body);
const spineY = j.spine[1];
const neckY = j.head[1];

function build(p: PartBuilder): void {
  // Coat: sharp shoulders, diagonal double-breasted front, long skirts.
  p.box("hips", SLOT.outfitDark, [0.32, 0.18, 0.24], [0, body.hipY + 0.03, 0]);
  p.box("spine", SLOT.outfit, [0.46, 0.62, 0.32], [0, spineY + 0.27, 0], { taper: [1.45, 1.05] });
  p.box("spine", SLOT.outfit, [0.76, 0.1, 0.32], [0, spineY + 0.52, 0], { taper: [0.9, 1] });
  p.box("spine", SLOT.trim, [0.035, 0.56, 0.02], [0.05, spineY + 0.27, 0.166], {
    rot: [0, 0, -0.18],
  });
  for (const dy of [0.1, 0.22, 0.34, 0.46]) {
    p.box("spine", SLOT.trim, [0.035, 0.035, 0.03], [0.1 - dy * 0.18, spineY + dy, 0.17]);
  }
  p.box("spine", SLOT.outfit, [0.2, 0.1, 0.2], [0, neckY + 0.02, 0]);
  p.mirror((side, b) => {
    p.box("hips", SLOT.outfit, [0.06, 0.56, 0.28], [side * 0.2, body.hipY - 0.2, -0.01], {
      taper: [0.8, 0.9],
    });
    p.box(
      b("thighL", "thighR"),
      SLOT.outfit,
      [0.18, 0.6, 0.07],
      [side * (body.hipX + 0.03), body.hipY - 0.22, 0.1],
    );
  });
  p.box("hips", SLOT.outfit, [0.46, 0.64, 0.08], [0, body.hipY - 0.2, -0.13], {
    taper: [0.85, 1],
    shear: [0, 0.03],
  });
  limbs(p, body, {
    sleeve: SLOT.outfit,
    hand: SLOT.trim,
    thigh: SLOT.outfitDark,
    shin: SLOT.black,
    shoe: SLOT.black,
    armW: 0.14,
    legW: 0.14,
    handSize: 0.15,
    shoeLength: 0.32,
  });
  // Head: long face, slicked hair with a widow's peak, goatee.
  neck(p, body, 0.07);
  skull(p, head, [0.96, 0.92]);
  p.box(
    "head",
    SLOT.hair,
    [head.hx * 2 + 0.03, 0.06, head.hz * 2 + 0.03],
    onHead(head, 0, head.hy + 0.01, -0.02),
    {
      taper: [0.9, 0.85],
      rot: [-0.12, 0, 0],
    },
  );
  p.box(
    "head",
    SLOT.hair,
    [head.hx * 2 + 0.03, head.hy * 1.5, 0.06],
    onHead(head, 0, head.hy * 0.25, -head.hz - 0.02),
  );
  p.box("head", SLOT.hair, [0.14, 0.14, 0.03], onHead(head, 0, head.hy - 0.01, head.hz + 0.004), {
    rot: [0, 0, Math.PI / 4],
  });
  p.mirror((side) => {
    p.box(
      "head",
      SLOT.hair,
      [0.035, 0.18, head.hz * 1.6],
      onHead(head, side * (head.hx + 0.012), head.hy * 0.2, -0.04),
    );
  });
  p.cone("head", SLOT.hair, 0.05, 0.14, onHead(head, 0, -head.hy - 0.04, head.hz - 0.03), {
    rot: [Math.PI + 0.3, 0, 0],
    sides: 4,
  });
  face(p, head, {
    eyeY: head.hy * 0.15,
    browSlant: 0.45,
    browSize: [0.13, 0.03, 0.04],
    nose: [0.06, 0.15, 0.1],
    smirk: 0.18,
    mouthWidth: 0.14,
  });
}

function accessory(p: PartBuilder, id: string): void {
  if (id === "cape") {
    const top = j.armL[1] + 0.06;
    p.box("spine", SLOT.outfitDark, [0.86, 1.36, 0.05], [0, top - 0.66, -0.25], {
      taper: [0.78, 1],
      shear: [0, 0.07],
    });
    p.box("spine", SLOT.trim, [0.8, 1.3, 0.02], [0, top - 0.64, -0.215], {
      taper: [0.78, 1],
      shear: [0, 0.07],
    });
    p.mirror((side) => {
      p.box("spine", SLOT.outfitDark, [0.22, 0.26, 0.04], [side * 0.2, neckY + 0.07, -0.13], {
        rot: [0.35, 0, side * -0.35],
      });
    });
  } else if (id === "eyepatch") {
    const eyeX = head.hx * 0.42;
    p.box(
      "head",
      SLOT.black,
      [0.11, 0.1, 0.03],
      onHead(head, eyeX, head.hy * 0.15, head.hz + 0.02),
    );
    p.box(
      "head",
      SLOT.black,
      [head.hx * 2 + 0.03, 0.02, head.hz * 2 + 0.03],
      onHead(head, 0, head.hy * 0.3, 0),
      {
        rot: [0, 0, -0.25],
      },
    );
  } else if (id === "collar") {
    p.box("spine", SLOT.outfit, [0.6, 0.36, 0.06], [0, neckY + 0.14, -0.16], {
      taper: [1.5, 1],
      shear: [0, -0.08],
    });
    p.box("spine", SLOT.trim, [0.56, 0.32, 0.02], [0, neckY + 0.14, -0.125], {
      taper: [1.5, 1],
      shear: [0, -0.08],
    });
    p.mirror((side) => {
      p.box("spine", SLOT.outfit, [0.06, 0.32, 0.22], [side * 0.27, neckY + 0.12, -0.04], {
        taper: [1, 1],
        rot: [0, side * 0.5, side * -0.25],
      });
    });
  }
}

export const mastermind: ArchetypeModel = {
  id: "mastermind",
  body,
  style: {
    idle: "steepled",
    lean: -2,
    stride: 24,
    armSwing: 0,
    sway: 1,
    bob: 0.025,
    walkKeepsArms: true,
  },
  build,
  accessory,
};
