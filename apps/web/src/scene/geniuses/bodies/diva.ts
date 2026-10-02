/**
 * The diva: an hourglass in a floor-length evening gown slit at the front,
 * bare shoulders, opera gloves, a towering bouffant and red lips.
 * Accessories: cat-eye sunglasses, a pearl necklace, a jewelled tiara.
 */
import { SLOT } from "../palette.ts";
import type { PartBuilder } from "../parts.ts";
import { type Body, restJoints } from "../rig.ts";
import { FOOT_HEIGHT, face, headFrame, limbs, neck, onHead, skull } from "./common.ts";
import type { ArchetypeModel } from "./types.ts";

const body: Body = {
  hipY: 0.44 + 0.42 + FOOT_HEIGHT,
  hipX: 0.1,
  thigh: 0.44,
  shin: 0.42,
  waist: 0.12,
  torso: 0.48,
  shoulderY: 0.42,
  shoulderX: 0.23,
  upperArm: 0.32,
  foreArm: 0.3,
  head: 0.42,
  backDepth: 0.13,
  seatDrop: 0.12,
  height: 2.3,
};

const head = headFrame(body, 0.08, [0.95, 1.05, 0.95]);
const j = restJoints(body);
const spineY = j.spine[1];
const neckY = j.head[1];

function build(p: PartBuilder): void {
  // Gown: fitted bodice, flared hips, and leg panels that flow to the floor.
  p.box("spine", SLOT.outfit, [0.3, 0.22, 0.22], [0, spineY + 0.06, 0], { taper: [1.3, 1.1] });
  p.box("spine", SLOT.outfit, [0.4, 0.22, 0.26], [0, spineY + 0.27, 0.01], { taper: [0.95, 0.9] });
  p.box("spine", SLOT.skin, [0.36, 0.14, 0.2], [0, spineY + 0.43, 0], { taper: [1.05, 1] });
  p.box("spine", SLOT.trim, [0.42, 0.04, 0.27], [0, spineY + 0.37, 0.01]);
  p.box("hips", SLOT.outfit, [0.46, 0.34, 0.34], [0, body.hipY - 0.04, 0], { taper: [0.7, 0.75] });
  p.mirror((side, b) => {
    p.box(
      b("thighL", "thighR"),
      SLOT.outfit,
      [0.26, body.thigh + 0.04, 0.3],
      [side * (body.hipX + 0.04), body.hipY - body.thigh / 2 - 0.04, 0],
      { taper: [0.85, 0.85] },
    );
    p.box(
      b("shinL", "shinR"),
      SLOT.outfit,
      [0.32, body.shin + 0.06, 0.38],
      [side * (body.hipX + 0.06), FOOT_HEIGHT + body.shin / 2 - 0.05, -0.02],
      { taper: [0.75, 0.7] },
    );
  });
  limbs(p, body, {
    sleeve: SLOT.skin,
    fore: SLOT.trim,
    hand: SLOT.trim,
    thigh: SLOT.skin,
    shin: SLOT.skin,
    shoe: SLOT.lipstick,
    armW: 0.09,
    legW: 0.1,
    handSize: 0.12,
    shoeLength: 0.24,
  });
  // Head: a long neck, lashes, red lips, a towering bouffant with a flip.
  neck(p, body, 0.055, 0.12);
  skull(p, head, [0.92, 0.85]);
  p.ball("head", SLOT.hair, [0.3, 0.28, 0.28], onHead(head, 0, head.hy + 0.1, -0.06), {
    detail: 1,
  });
  p.mirror((side) => {
    p.ball(
      "head",
      SLOT.hair,
      [0.1, 0.2, 0.18],
      onHead(head, side * (head.hx + 0.04), -0.02, -0.06),
    );
    p.cone(
      "head",
      SLOT.hair,
      0.07,
      0.16,
      onHead(head, side * (head.hx + 0.1), -head.hy + 0.02, -0.04),
      {
        rot: [0, 0, side * 2.3],
        sides: 5,
      },
    );
    p.box(
      "head",
      SLOT.black,
      [0.1, 0.02, 0.03],
      onHead(head, side * head.hx * 0.42, head.hy * 0.16 + 0.04, head.hz + 0.02),
      {
        rot: [0, 0, -side * 0.25],
      },
    );
  });
  face(p, head, {
    browSlant: -0.1,
    browSize: [0.11, 0.022, 0.03],
    nose: [0.05, 0.09, 0.07],
    mouthSlot: SLOT.lipstick,
    mouthWidth: 0.1,
    smirk: 0.1,
    ears: false,
  });
  p.box(
    "head",
    SLOT.lipstick,
    [0.07, 0.035, 0.025],
    onHead(head, 0.005, -head.hy * 0.52 - 0.015, head.hz + 0.004),
  );
  p.box("head", SLOT.pupil, [0.02, 0.02, 0.01], onHead(head, 0.1, -head.hy * 0.3, head.hz + 0.004));
}

function accessory(p: PartBuilder, id: string): void {
  if (id === "sunglasses") {
    p.mirror((side) => {
      p.box(
        "head",
        SLOT.black,
        [0.15, 0.09, 0.03],
        onHead(head, side * 0.09, head.hy * 0.14, head.hz + 0.03),
        {
          rot: [0, 0, side * 0.2],
          taper: [1.25, 1],
        },
      );
      p.box(
        "head",
        SLOT.pupil,
        [0.12, 0.06, 0.02],
        onHead(head, side * 0.09, head.hy * 0.14, head.hz + 0.04),
        {
          rot: [0, 0, side * 0.2],
        },
      );
    });
  } else if (id === "pearls") {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.15 + (0.7 * i) / (n - 1));
      p.ball("spine", SLOT.pearl, 0.028, [
        Math.cos(a) * 0.15,
        neckY - 0.06 - Math.sin(a) * 0.06,
        0.04 + Math.sin(a) * 0.09,
      ]);
    }
  } else if (id === "tiara") {
    const top = onHead(head, 0, head.hy + 0.05, 0.12);
    p.box("head", SLOT.gold, [0.3, 0.04, 0.04], top, { rot: [-0.4, 0, 0] });
    p.cone("head", SLOT.gold, 0.05, 0.12, [top[0], top[1] + 0.07, top[2] + 0.02], {
      sides: 4,
      rot: [-0.4, 0, 0],
    });
    p.ball("head", SLOT.glow, 0.035, [top[0], top[1] + 0.05, top[2] + 0.05]);
    p.mirror((side) => {
      p.cone("head", SLOT.gold, 0.035, 0.08, [top[0] + side * 0.09, top[1] + 0.04, top[2]], {
        sides: 4,
        rot: [-0.4, 0, 0],
      });
    });
  }
}

export const diva: ArchetypeModel = {
  id: "diva",
  body,
  head,
  style: { idle: "hand_on_hip", lean: -3, stride: 18, armSwing: 14, sway: 9, bob: 0.02 },
  build,
  accessory,
  extraHeight: (a) => (a === "tiara" ? 0.05 : 0),
};
