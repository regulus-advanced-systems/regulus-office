/**
 * The hacker: a stooped beanpole with a big head of messy hair, a baggy
 * hoodie (hood down, drawstrings, kangaroo pocket), long arms and chunky
 * sneakers. Accessories: headphones, a glowing visor, a beanie.
 */
import { SLOT } from "../palette.ts";
import type { PartBuilder } from "../parts.ts";
import { type Body, restJoints } from "../rig.ts";
import { FOOT_HEIGHT, face, headFrame, limbs, neck, onHead, skull } from "./common.ts";
import type { ArchetypeModel } from "./types.ts";

const body: Body = {
  hipY: 0.42 + 0.4 + FOOT_HEIGHT,
  hipX: 0.11,
  thigh: 0.42,
  shin: 0.4,
  waist: 0.1,
  torso: 0.48,
  shoulderY: 0.4,
  shoulderX: 0.27,
  upperArm: 0.36,
  foreArm: 0.34,
  head: 0.5,
  backDepth: 0.17,
  seatDrop: 0.1,
  height: 2.16,
};

const head = headFrame(body, 0.05, [1, 0.95, 0.95]);
const j = restJoints(body);
const spineY = j.spine[1];
const neckY = j.head[1];

/** Messy tufts: [x, y, z, rotX, rotZ] on the top of the head. */
const TUFTS: [number, number, number, number, number][] = [
  [0.02, -0.02, 0.17, 1.9, 0.2],
  [0.12, -0.03, 0.14, 1.7, -0.5],
  [-0.1, -0.02, 0.15, 1.8, 0.4],
  [0.16, -0.02, 0.0, 0.4, -1.4],
  [-0.17, -0.02, -0.02, 0.2, 1.3],
  [0.06, 0.0, -0.12, -0.9, -0.3],
  [-0.08, 0.0, -0.1, -1.0, 0.4],
  [0.0, 0.04, 0.0, 0.2, 0.3],
];

function build(p: PartBuilder): void {
  // Hoodie: baggy, hood bunched behind the neck, pocket and drawstrings.
  p.box("hips", SLOT.outfitDark, [0.3, 0.18, 0.22], [0, body.hipY + 0.03, 0]);
  p.box("spine", SLOT.outfit, [0.5, 0.56, 0.32], [0, spineY + 0.22, 0], { taper: [0.92, 0.95] });
  p.box("spine", SLOT.outfit, [0.54, 0.1, 0.34], [0, spineY - 0.04, 0]);
  p.box("spine", SLOT.outfitDark, [0.3, 0.16, 0.03], [0, spineY + 0.08, 0.165], {
    taper: [0.8, 1],
  });
  p.ball("spine", SLOT.outfit, [0.22, 0.13, 0.13], [0, neckY + 0.0, -0.14]);
  p.mirror((side) => {
    p.box("spine", SLOT.pearl, [0.018, 0.16, 0.018], [side * 0.06, neckY - 0.12, 0.17]);
  });
  limbs(p, body, {
    sleeve: SLOT.outfit,
    hand: SLOT.skin,
    thigh: SLOT.outfitDark,
    shin: SLOT.outfitDark,
    shoe: SLOT.trim,
    armW: 0.13,
    legW: 0.14,
    handSize: 0.14,
    shoeLength: 0.34,
  });
  // Sneaker soles and hoodie cuffs.
  p.mirror((side, b) => {
    p.box(b("shinL", "shinR"), SLOT.pearl, [0.18, 0.04, 0.35], [side * body.hipX, 0.02, 0.09]);
    p.box(
      b("foreL", "foreR"),
      SLOT.outfitDark,
      [0.13, 0.06, 0.13],
      [side * body.shoulderX, j.armL[1] - body.upperArm - body.foreArm + 0.03, 0],
    );
  });
  // Head: big, with a mop of messy hair.
  neck(p, body, 0.06);
  skull(p, head, [1.04, 1.02]);
  p.ball(
    "head",
    SLOT.hair,
    [head.hx + 0.04, 0.13, head.hz + 0.04],
    onHead(head, 0, head.hy - 0.01, -0.02),
    {
      detail: 1,
    },
  );
  p.box("head", SLOT.hair, [head.hx * 2 + 0.03, 0.3, 0.06], onHead(head, 0, 0.02, -head.hz - 0.02));
  for (const [x, y, z, rx, rz] of TUFTS) {
    p.cone("head", SLOT.hair, 0.09, 0.22, onHead(head, x, head.hy + 0.06 + y, z), {
      rot: [rx, 0, rz],
      sides: 4,
    });
  }
  face(p, head, { browSlant: 0.12, smirk: 0.3, mouthWidth: 0.1, eyeY: head.hy * 0.05 });
  // Tired eyes.
  p.mirror((side) => {
    p.box(
      "head",
      SLOT.skinShade,
      [0.09, 0.025, 0.015],
      onHead(head, side * head.hx * 0.42, -0.02, head.hz + 0.004),
    );
  });
}

function accessory(p: PartBuilder, id: string): void {
  if (id === "headphones") {
    p.box("head", SLOT.black, [head.hx * 2 + 0.12, 0.05, 0.08], onHead(head, 0, head.hy + 0.12, 0));
    p.mirror((side) => {
      const at = onHead(head, side * (head.hx + 0.06), 0, 0);
      p.cyl("head", SLOT.black, 0.11, 0.11, 0.08, at, { rot: [0, 0, Math.PI / 2], sides: 8 });
      p.cyl("head", SLOT.trim, 0.08, 0.08, 0.02, [at[0] + side * 0.045, at[1], at[2]], {
        rot: [0, 0, Math.PI / 2],
        sides: 8,
      });
      p.box(
        "head",
        SLOT.black,
        [0.04, 0.16, 0.05],
        onHead(head, side * (head.hx + 0.06), head.hy + 0.02, 0),
      );
    });
  } else if (id === "visor") {
    p.box(
      "head",
      SLOT.black,
      [head.hx * 2 + 0.06, 0.12, 0.06],
      onHead(head, 0, head.hy * 0.08, head.hz + 0.02),
    );
    p.box(
      "head",
      SLOT.glow,
      [head.hx * 2 - 0.04, 0.06, 0.02],
      onHead(head, 0, head.hy * 0.08, head.hz + 0.05),
    );
    p.mirror((side) => {
      p.box(
        "head",
        SLOT.black,
        [0.03, 0.06, head.hz * 2],
        onHead(head, side * (head.hx + 0.02), head.hy * 0.08, 0),
      );
    });
  } else if (id === "beanie") {
    p.ball(
      "head",
      SLOT.trim,
      [head.hx + 0.04, 0.2, head.hz + 0.04],
      onHead(head, 0, head.hy + 0.02, -0.01),
    );
    p.box(
      "head",
      SLOT.trim,
      [head.hx * 2 + 0.06, 0.09, head.hz * 2 + 0.06],
      onHead(head, 0, head.hy * 0.62, 0),
    );
    p.ball("head", SLOT.pearl, 0.06, onHead(head, 0, head.hy + 0.24, -0.01));
  }
}

export const hacker: ArchetypeModel = {
  id: "hacker",
  body,
  style: { idle: "hands_in_pocket", lean: 16, stride: 22, armSwing: 10, sway: 3, bob: 0.025 },
  build,
  accessory,
  extraHeight: (a) => (a === "beanie" ? 0.08 : 0),
};
