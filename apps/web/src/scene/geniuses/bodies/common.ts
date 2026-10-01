/**
 * Shared anatomy for the archetype builders: limbs along the bones, mitten
 * hands, chunky shoes and an expressive face kit (scheming brows, big nose,
 * smirk). Archetypes add their silhouette on top.
 */

import { SLOT, type Slot } from "../palette.ts";
import type { PartBuilder } from "../parts.ts";
import { type Body, restJoints, type Vec3 } from "../rig.ts";

export const FOOT_HEIGHT = 0.09;

/** Centre of the head cube and its half extents (the face is the +z side). */
export interface HeadFrame {
  c: Vec3;
  hx: number;
  hy: number;
  hz: number;
}

export function headFrame(body: Body, neck = 0.05, shape: Vec3 = [1, 1, 1]): HeadFrame {
  const [, y] = restJoints(body).head;
  const hy = (body.head / 2) * shape[1];
  return {
    c: [0, y + neck + hy, 0],
    hx: (body.head / 2) * shape[0],
    hy,
    hz: (body.head / 2) * shape[2],
  };
}

/** Point on the head relative to its centre. */
export const onHead = (h: HeadFrame, x: number, y: number, z: number): Vec3 => [
  h.c[0] + x,
  h.c[1] + y,
  h.c[2] + z,
];

export interface LimbStyle {
  sleeve: Slot;
  /** Forearm slot (gloves, bare arms); defaults to the sleeve. */
  fore?: Slot;
  hand: Slot;
  thigh: Slot;
  shin: Slot;
  shoe: Slot;
  armW: number;
  legW: number;
  /** Bigger mitts for the comic look. */
  handSize?: number;
  shoeLength?: number;
}

/** Arms, hands, legs and shoes along the rest skeleton. */
export function limbs(p: PartBuilder, body: Body, s: LimbStyle): void {
  const j = restJoints(body);
  const hand = s.handSize ?? 0.13;
  const shoe = s.shoeLength ?? 0.3;
  p.mirror((side, b) => {
    const [ax, ay] = side === 1 ? j.armL : j.armR;
    p.box(
      b("armL", "armR"),
      s.sleeve,
      [s.armW, body.upperArm + 0.04, s.armW],
      [ax, ay - body.upperArm / 2, 0],
    );
    p.box(
      b("foreL", "foreR"),
      s.fore ?? s.sleeve,
      [s.armW * 0.9, body.foreArm, s.armW * 0.9],
      [ax, ay - body.upperArm - body.foreArm / 2, 0],
    );
    p.ball(
      b("foreL", "foreR"),
      s.hand,
      [hand * 0.55, hand * 0.62, hand * 0.5],
      [ax, ay - body.upperArm - body.foreArm - hand * 0.45, 0.01],
    );
    const [lx] = side === 1 ? j.thighL : j.thighR;
    p.box(
      b("thighL", "thighR"),
      s.thigh,
      [s.legW, body.thigh + 0.04, s.legW],
      [lx, body.hipY - body.thigh / 2, 0],
    );
    p.box(
      b("shinL", "shinR"),
      s.shin,
      [s.legW * 0.88, body.shin, s.legW * 0.88],
      [lx, body.hipY - body.thigh - body.shin / 2, 0],
    );
    p.box(
      b("shinL", "shinR"),
      s.shoe,
      [s.legW + 0.03, FOOT_HEIGHT, shoe],
      [lx, FOOT_HEIGHT / 2, shoe / 2 - 0.08],
      { taper: [0.85, 0.8] },
    );
  });
}

export interface FaceStyle {
  eyeX?: number;
  eyeY?: number;
  /** Brow slant in radians: positive = scheming (inner ends down). */
  browSlant?: number;
  browSlot?: Slot;
  browSize?: Vec3;
  nose?: Vec3;
  mouthWidth?: number;
  /** Mouth tilt: a smirk. */
  smirk?: number;
  mouthSlot?: Slot;
  ears?: boolean;
}

/** Eyes with pupils glancing sideways, slanted brows, a big nose, a smirk, ears. */
export function face(p: PartBuilder, h: HeadFrame, f: FaceStyle = {}): void {
  const z = h.hz;
  const eyeX = f.eyeX ?? h.hx * 0.42;
  const eyeY = f.eyeY ?? h.hy * 0.12;
  const slant = f.browSlant ?? 0.32;
  const brow = f.browSize ?? [0.12, 0.035, 0.04];
  p.mirror((side) => {
    p.box("head", SLOT.eyeWhite, [0.085, 0.07, 0.02], onHead(h, side * eyeX, eyeY, z + 0.004));
    p.box(
      "head",
      SLOT.pupil,
      [0.038, 0.05, 0.02],
      onHead(h, side * eyeX - 0.018, eyeY - 0.005, z + 0.012),
    );
    p.box("head", f.browSlot ?? SLOT.hair, brow, onHead(h, side * eyeX, eyeY + 0.075, z + 0.012), {
      rot: [0, 0, side * slant],
    });
    if (f.ears !== false) {
      p.box("head", SLOT.skinShade, [0.04, 0.1, 0.07], onHead(h, side * (h.hx + 0.015), 0, 0));
    }
  });
  const nose = f.nose ?? [0.075, 0.12, 0.1];
  p.box("head", SLOT.skinShade, nose, onHead(h, 0, eyeY - 0.08, z + nose[2] / 2 - 0.01), {
    taper: [0.6, 0.5],
  });
  p.box(
    "head",
    f.mouthSlot ?? SLOT.mouth,
    [f.mouthWidth ?? 0.13, 0.026, 0.02],
    onHead(h, 0.01, -h.hy * 0.52, z + 0.004),
    {
      rot: [0, 0, f.smirk ?? 0.14],
    },
  );
}

/** Flat-to-flat width of an octagon is cos(22.5°) of its corner-to-corner width. */
const OCTAGON_FLAT = Math.cos(Math.PI / 8);

/**
 * The head: an octagonal block in skin (a flat face at the front for the
 * features, chamfered corners for a sculpted low-poly look). `taper` scales
 * the top relative to the bottom: >1 for a domed brow, <1 for a narrow crown.
 */
export function skull(p: PartBuilder, h: HeadFrame, taper: [number, number] = [1, 1]): void {
  const r = h.hx / OCTAGON_FLAT;
  const top = (taper[0] + taper[1]) / 2;
  p.cyl("head", SLOT.skin, r * top, r, h.hy * 2, h.c, {
    sides: 8,
    thetaStart: Math.PI / 8,
    scale: [1, 1, h.hz / h.hx],
  });
}

/** Neck cylinder between the torso and the head. */
export function neck(
  p: PartBuilder,
  body: Body,
  radius: number,
  length = 0.08,
  slot: Slot = SLOT.skin,
): void {
  const [, y] = restJoints(body).head;
  p.cyl("head", slot, radius, radius * 1.1, length, [0, y + length / 2 - 0.02, 0]);
}
