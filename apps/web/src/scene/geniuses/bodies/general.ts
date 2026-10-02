/**
 * The general: a V-shaped slab of a soldier, chest out, shoulders twice the
 * width of the waist with fringed epaulettes, riding breeches ballooning
 * over tall boots, a square jaw and a flat-top. Accessories: a peaked cap,
 * a chest full of medals, a handlebar moustache.
 */
import { SLOT } from "../palette.ts";
import type { PartBuilder } from "../parts.ts";
import { type Body, restJoints } from "../rig.ts";
import { FOOT_HEIGHT, face, headFrame, limbs, neck, onHead, skull } from "./common.ts";
import type { ArchetypeModel } from "./types.ts";

const body: Body = {
  hipY: 0.42 + 0.4 + FOOT_HEIGHT,
  hipX: 0.14,
  thigh: 0.42,
  shin: 0.4,
  waist: 0.1,
  torso: 0.62,
  shoulderY: 0.54,
  shoulderX: 0.46,
  upperArm: 0.36,
  foreArm: 0.32,
  head: 0.42,
  backDepth: 0.22,
  seatDrop: 0.12,
  height: 2.12,
};

const head = headFrame(body, 0.04, [1, 1.05, 1]);
const j = restJoints(body);
const spineY = j.spine[1];
const neckY = j.head[1];

function build(p: PartBuilder): void {
  // Waist, belt, and the huge chest.
  p.box("hips", SLOT.outfitDark, [0.36, 0.2, 0.26], [0, body.hipY + 0.03, 0]);
  p.box("spine", SLOT.outfit, [0.38, 0.2, 0.28], [0, spineY + 0.06, 0], { taper: [1.3, 1.1] });
  p.box("spine", SLOT.black, [0.4, 0.07, 0.3], [0, spineY + 0.02, 0]);
  p.box("spine", SLOT.gold, [0.08, 0.06, 0.03], [0, spineY + 0.02, 0.16]);
  p.box("spine", SLOT.outfit, [0.56, 0.44, 0.4], [0, spineY + 0.37, 0.01], { taper: [1.55, 1.05] });
  // Double row of buttons and a high collar.
  for (const dy of [0.2, 0.3, 0.4]) {
    for (const side of [1, -1]) {
      p.box(
        "spine",
        SLOT.gold,
        [0.035, 0.035, 0.03],
        [side * (0.07 + dy * 0.1), spineY + dy, 0.215 + dy * 0.02],
      );
    }
  }
  p.box("spine", SLOT.outfit, [0.3, 0.1, 0.28], [0, neckY + 0.01, 0]);
  p.box("spine", SLOT.trim, [0.31, 0.03, 0.29], [0, neckY + 0.05, 0]);
  // Epaulettes with fringe.
  p.mirror((side) => {
    p.box(
      "spine",
      SLOT.trim,
      [0.26, 0.06, 0.24],
      [side * (body.shoulderX - 0.05), j.armL[1] + 0.09, 0],
    );
    for (const dz of [-0.08, 0, 0.08]) {
      p.box(
        "spine",
        SLOT.gold,
        [0.025, 0.08, 0.025],
        [side * (body.shoulderX + 0.07), j.armL[1] + 0.03, dz],
      );
    }
  });
  limbs(p, body, {
    sleeve: SLOT.outfit,
    hand: SLOT.pearl,
    thigh: SLOT.outfitDark,
    shin: SLOT.black,
    shoe: SLOT.black,
    armW: 0.17,
    legW: 0.16,
    handSize: 0.17,
    shoeLength: 0.32,
  });
  // Breeches balloon at the thigh; boot tops.
  p.mirror((side, b) => {
    p.ball(
      b("thighL", "thighR"),
      SLOT.outfitDark,
      [0.14, 0.2, 0.14],
      [side * (body.hipX + 0.04), body.hipY - body.thigh * 0.55, 0],
    );
    p.box(
      b("shinL", "shinR"),
      SLOT.black,
      [0.2, 0.06, 0.2],
      [side * body.hipX, body.hipY - body.thigh - 0.03, 0],
    );
    p.box(
      b("foreL", "foreR"),
      SLOT.trim,
      [0.18, 0.05, 0.18],
      [side * body.shoulderX, j.armL[1] - body.upperArm - body.foreArm + 0.03, 0],
    );
  });
  // Head: square, a jaw like an anvil, flat-top.
  neck(p, body, 0.1, 0.06);
  skull(p, head, [1, 1]);
  p.box(
    "head",
    SLOT.skin,
    [head.hx * 2 + 0.04, 0.16, head.hz * 2 + 0.02],
    onHead(head, 0, -head.hy + 0.02, 0.02),
    {
      taper: [0.95, 1],
    },
  );
  p.box(
    "head",
    SLOT.skinShade,
    [0.12, 0.06, 0.04],
    onHead(head, 0, -head.hy - 0.03, head.hz + 0.02),
  );
  p.box(
    "head",
    SLOT.hair,
    [head.hx * 2 + 0.02, 0.08, head.hz * 2 + 0.02],
    onHead(head, 0, head.hy, 0),
  );
  // Short back and sides.
  p.box(
    "head",
    SLOT.hair,
    [head.hx * 2 + 0.025, head.hy, head.hz * 1.4],
    onHead(head, 0, head.hy * 0.5, -head.hz * 0.32),
  );
  face(p, head, {
    eyeY: head.hy * 0.18,
    browSize: [0.14, 0.04, 0.04],
    browSlant: 0.4,
    nose: [0.08, 0.1, 0.09],
    smirk: 0,
    mouthWidth: 0.16,
  });
}

function accessory(p: PartBuilder, id: string): void {
  if (id === "peaked_cap") {
    const top = head.c[1] + head.hy;
    p.cyl("head", SLOT.outfit, 0.3, 0.24, 0.16, [0, top + 0.08, -0.01], { sides: 10 });
    p.cyl("head", SLOT.trim, 0.245, 0.245, 0.05, [0, top + 0.02, -0.01], { sides: 10 });
    p.box("head", SLOT.black, [0.36, 0.03, 0.16], [0, top + 0.0, head.hz + 0.05], {
      rot: [0.25, 0, 0],
    });
    p.box("head", SLOT.gold, [0.08, 0.07, 0.03], [0, top + 0.08, head.hz + 0.04]);
  } else if (id === "medals") {
    const slots = [SLOT.gold, SLOT.silver, SLOT.lipstick, SLOT.gold, SLOT.trim];
    slots.forEach((slot, i) => {
      const x = 0.06 + i * 0.07;
      p.box("spine", SLOT.lipstick, [0.055, 0.07, 0.03], [x, spineY + 0.5, 0.25]);
      p.cyl("spine", slot, 0.035, 0.035, 0.03, [x, spineY + 0.42, 0.255], {
        rot: [Math.PI / 2, 0, 0],
        sides: 6,
      });
    });
  } else if (id === "moustache") {
    p.mirror((side) => {
      p.box(
        "head",
        SLOT.hair,
        [0.16, 0.05, 0.05],
        onHead(head, side * 0.08, -head.hy * 0.32, head.hz + 0.03),
        {
          rot: [0, 0, side * 0.25],
        },
      );
      p.cone(
        "head",
        SLOT.hair,
        0.03,
        0.09,
        onHead(head, side * 0.18, -head.hy * 0.22, head.hz + 0.03),
        {
          rot: [0, 0, -side * 0.6],
          sides: 4,
        },
      );
    });
  }
}

export const general: ArchetypeModel = {
  id: "general",
  body,
  head,
  style: {
    idle: "hands_behind",
    lean: -7,
    stride: 30,
    armSwing: 0,
    sway: 1,
    bob: 0.04,
    walkKeepsArms: true,
  },
  build,
  accessory,
  extraHeight: (a) => (a === "peaked_cap" ? 0.16 : 0),
};
