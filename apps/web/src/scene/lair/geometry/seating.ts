/**
 * Lair seating (#183): the henchman swivel chair, a 1960s pedestal lounge
 * chair, a low walnut sofa and a locker-room bench. Sitter faces +z with
 * the backrest toward -z, like the Kenney chairs, so the #163/#167 sit
 * anchors work unchanged: each sittable piece publishes its sit points
 * (cushion top, backrest front and top, armrest gap) from the same numbers
 * that build it, and models.ts turns them into the `SitSpec` fractions of
 * the built mesh's bounds, so the seat height and sit offset stay
 * data-driven per chair model.
 */
import type { SitSpec } from "../../furniture/catalog.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

/**
 * Where a sitter goes on a piece, in the piece's own metres (sitter facing
 * +z). models.ts turns these into a `SitSpec` against the built geometry's
 * bounds, so the fractions always match the mesh that is drawn.
 */
export interface SitPoints {
  /** Top of the seat cushion. */
  seatY: number;
  /** z of the backrest's front face. */
  backFrontZ: number;
  /** Top of the backrest. */
  backTopY: number;
  /** Inner face of the armrests, distance from the centre line; absent without arms. */
  armInnerX?: number;
}

/** A `SitSpec` (fractions of the bounds, catalog.ts) from sit points and the piece's bounds. */
export function sitSpecFromBounds(
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  points: SitPoints,
): SitSpec {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const size = {
    w: r(bounds.max.x - bounds.min.x),
    h: r(bounds.max.y - bounds.min.y),
    d: r(bounds.max.z - bounds.min.z),
  };
  return {
    size,
    seatTop: r((points.seatY - bounds.min.y) / size.h),
    backFront: r((points.backFrontZ - bounds.min.z) / size.d),
    backTop: r((points.backTopY - bounds.min.y) / size.h),
    ...(points.armInnerX !== undefined
      ? { armrestsInner: r(points.armInnerX / (size.w / 2)) }
      : {}),
  };
}

// ---- Swivel desk chair ----------------------------------------------------------

/** Cushion top 0.33 m and backrest top 0.82 m: the same seated fit as the #163 desk chair. */
const CHAIR = {
  seat: 0.33,
  top: 0.82,
  base: 0.29,
  backZ: -0.19,
  backT: 0.07,
  seatW: 0.46,
  seatD: 0.44,
} as const;

export const SWIVEL_CHAIR_SEAT: SitPoints = {
  seatY: CHAIR.seat,
  backFrontZ: CHAIR.backZ + CHAIR.backT / 2,
  backTopY: CHAIR.top,
};

export function swivelChair(): PieceGeometry {
  const b = new PartBuilder(81);
  const { seat, top, base, backZ, backT, seatW, seatD } = CHAIR;
  // Five-star chrome base on casters.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const len = base - 0.03;
    b.box(
      [0.05, 0.035, len],
      [Math.sin(a) * (len / 2), 0.06, Math.cos(a) * (len / 2)],
      LAIR.chrome,
      { rot: [0, a, 0] },
    );
    b.sphere(
      0.03,
      6,
      4,
      [Math.sin(a) * (base - 0.03), 0.03, Math.cos(a) * (base - 0.03)],
      LAIR.black,
    );
  }
  b.cylinder(0.03, 0.03, seat - 0.16, 8, [0, 0.08 + (seat - 0.16) / 2, 0], LAIR.chrome, {
    smooth: true,
  });
  // Moulded shell and a leather cushion.
  b.box([seatW + 0.02, 0.05, seatD + 0.02], [0, seat - 0.085, 0], LAIR.cream);
  b.box([seatW, 0.06, seatD], [0, seat - 0.03, 0.01], LAIR.orange, { jitter: 0.08 });
  // Backrest: a cream shell with an orange pad, on a chrome spine.
  const backH = top - seat - 0.08;
  b.box([0.04, 0.2, 0.03], [0, seat + 0.02, backZ - 0.02], LAIR.chrome);
  b.box([seatW, backH, backT * 0.5], [0, top - backH / 2, backZ - backT * 0.25], LAIR.cream);
  b.box(
    [seatW - 0.06, backH - 0.06, backT * 0.5],
    [0, top - backH / 2, backZ + backT * 0.25],
    LAIR.orange,
    { jitter: 0.08 },
  );
  return { body: b.build() };
}

// ---- Pedestal lounge chair --------------------------------------------------------

const LOUNGE = { w: 0.86, d: 0.8, h: 0.95, seat: 0.42, back: 0.14, arm: 0.11 } as const;

export const LOUNGE_CHAIR_SEAT: SitPoints = {
  seatY: LOUNGE.seat,
  backFrontZ: -LOUNGE.d / 2 + LOUNGE.back,
  backTopY: LOUNGE.h,
  armInnerX: LOUNGE.w / 2 - LOUNGE.arm,
};

export function loungeChair(): PieceGeometry {
  const b = new PartBuilder(82);
  const { w, d, h, seat, back, arm } = LOUNGE;
  b.cylinder(0.3, 0.32, 0.04, 14, [0, 0.02, 0], LAIR.chrome, { smooth: true });
  b.cylinder(0.05, 0.07, 0.2, 8, [0, 0.14, 0], LAIR.chrome, { smooth: true });
  // Walnut shell tub, a teal cushion, a high back and two arms.
  b.box([w, 0.16, d], [0, seat - 0.17, 0], LAIR.walnut, { jitter: 0.06 });
  b.box([w - 2 * arm, 0.1, d - back], [0, seat - 0.05, back / 2], "#2A7F86", { jitter: 0.08 });
  b.box([w, h - seat + 0.1, back], [0, (h + seat - 0.1) / 2, -d / 2 + back / 2], LAIR.walnut, {
    rot: [-0.08, 0, 0],
  });
  b.box(
    [w - 2 * arm, h - seat - 0.08, 0.08],
    [0, (h + seat) / 2, -d / 2 + back + 0.02],
    "#2A7F86",
    { rot: [-0.08, 0, 0], jitter: 0.08 },
  );
  for (const side of [-1, 1])
    b.box([arm, 0.22, d - 0.05], [side * (w / 2 - arm / 2), seat + 0.02, 0.02], LAIR.walnut);
  return { body: b.build() };
}

// ---- Low sofa ---------------------------------------------------------------------

const SOFA = { w: 2.0, d: 0.85, h: 0.8, seat: 0.44, back: 0.2, arm: 0.14 } as const;

export const SOFA_SEAT: SitPoints = {
  seatY: SOFA.seat,
  backFrontZ: -SOFA.d / 2 + SOFA.back,
  backTopY: SOFA.h,
  armInnerX: SOFA.w / 2 - SOFA.arm,
};

export function sofa(): PieceGeometry {
  const b = new PartBuilder(83);
  const { w, d, h, seat, back, arm } = SOFA;
  // Tapered walnut legs and a frame.
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      b.cylinder(
        0.025,
        0.015,
        0.14,
        6,
        [x * (w / 2 - 0.1), 0.07, z * (d / 2 - 0.1)],
        LAIR.walnutDark,
      );
  b.box([w, 0.14, d], [0, 0.21, 0], LAIR.walnut);
  // Two seat cushions (a dent in one: lived in), the back cushions and arms.
  const cw = (w - 2 * arm) / 2;
  for (const side of [-1, 1]) {
    b.box(
      [cw - 0.02, seat - 0.28, d - back - 0.02],
      [side * (cw / 2), 0.28 + (seat - 0.28) / 2, back / 2],
      LAIR.leather,
      { jitter: 0.1 },
    );
    b.box(
      [cw - 0.02, h - seat, back],
      [side * (cw / 2), seat + (h - seat) / 2, -d / 2 + back / 2],
      LAIR.leather,
      { rot: [-0.1, 0, 0], jitter: 0.1 },
    );
  }
  b.box([0.18, 0.18, 0.08], [-0.55, seat + 0.1, -d / 2 + back + 0.06], LAIR.yellow, {
    rot: [-0.3, 0.2, 0.1],
  });
  for (const side of [-1, 1])
    b.box(
      [arm, seat + 0.1 - 0.28, d],
      [side * (w / 2 - arm / 2), 0.28 + (seat + 0.1 - 0.28) / 2, 0],
      LAIR.walnut,
    );
  return { body: b.build() };
}

/** Locker-room bench, 1.4 x 0.4 m, 0.45 m tall: oak slats on steel legs. */
export function bench(): PieceGeometry {
  const b = new PartBuilder(84);
  const w = 1.4;
  for (const x of [-1, 1]) {
    b.box([0.05, 0.42, 0.34], [x * (w / 2 - 0.12), 0.21, 0], LAIR.steelDark);
    b.box([0.1, 0.03, 0.38], [x * (w / 2 - 0.12), 0.015, 0], LAIR.steelDark);
  }
  for (let i = 0; i < 3; i++)
    b.box([w, 0.035, 0.11], [0, 0.435, -0.13 + i * 0.13], LAIR.crate, { jitter: 0.12 });
  // A towel and a pair of boots.
  b.box([0.3, 0.02, 0.36], [0.35, 0.462, 0], LAIR.cream, { rot: [0, 0.2, 0] });
  b.box([0.11, 0.16, 0.26], [-0.3, 0.08, 0.3], LAIR.black);
  b.box([0.11, 0.16, 0.26], [-0.16, 0.08, 0.32], LAIR.black, { rot: [0, 0.3, 0] });
  return { body: b.build() };
}
