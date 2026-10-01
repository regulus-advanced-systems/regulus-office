/**
 * Decor-style pieces for the generated rooms (#182 model ids, #183 art):
 * desk clutter (a desk plant, mugs, a fruit bowl, a book stack), the
 * workshop's workbench, stools and the war room's leather chair (with sit
 * points), a map chest, a rolling tool chest, small plants for each style,
 * and the lab tile and war-room carpet floors. Fronts toward +z; floor
 * pieces stand on y = 0, clutter on the surface it is placed on.
 */
import { TILE } from "../dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";
import type { SitPoints } from "./seating.ts";
import { frond } from "./storage.ts";

// ---- Desk clutter -------------------------------------------------------------------

export function deskPlant(): PieceGeometry {
  const b = new PartBuilder(301);
  b.cylinder(0.06, 0.045, 0.09, 8, [0, 0.045, 0], LAIR.terracotta);
  for (let k = 0; k < 5; k++)
    frond(b, [0, 0.09, 0], (k / 5) * Math.PI * 2, -0.04, 0.12, k % 2 ? LAIR.leaf : LAIR.leafLight);
  return { body: b.build() };
}

export function deskMugs(): PieceGeometry {
  const b = new PartBuilder(302);
  for (const [x, z, c] of [
    [-0.05, 0, LAIR.orange],
    [0.06, 0.03, LAIR.cream],
  ] as const) {
    b.cylinder(0.035, 0.03, 0.09, 8, [x, 0.045, z], c, { smooth: true });
    b.cylinder(0.03, 0.03, 0.005, 8, [x, 0.088, z], "#3B2416");
    b.box([0.012, 0.04, 0.02], [x + 0.042, 0.05, z], c);
  }
  return { body: b.build() };
}

export function fruitBowl(): PieceGeometry {
  const b = new PartBuilder(303);
  b.cylinder(0.12, 0.06, 0.06, 10, [0, 0.03, 0], LAIR.brass, { smooth: true });
  for (const [x, z, c] of [
    [-0.04, 0, LAIR.orange],
    [0.04, 0.02, LAIR.orange],
    [0, -0.04, "#B8D44A"],
    [0.01, 0.04, LAIR.red],
  ] as const) {
    b.sphere(0.04, 6, 4, [x, 0.08, z], c);
  }
  b.cylinder(0.015, 0.02, 0.16, 5, [0.02, 0.1, -0.01], LAIR.yellow, { rot: [0, 0, 1.2] });
  return { body: b.build() };
}

export function deskBooks(): PieceGeometry {
  const b = new PartBuilder(304);
  const stack = [
    [0.22, 0.04, 0.16, LAIR.red, 0],
    [0.2, 0.035, 0.15, LAIR.teal, 0.2],
    [0.18, 0.03, 0.14, LAIR.cream, -0.15],
  ] as const;
  let y = 0;
  for (const [w, h, d, c, rot] of stack) {
    b.box([w, h, d], [0, y + h / 2, 0], c, { rot: [0, rot, 0] });
    y += h;
  }
  return { body: b.build() };
}

// ---- Style furniture ----------------------------------------------------------------

/** A workshop workbench, 1.8 x 0.8 m, its butcher-block top at `top` metres, a vice on one end. */
export function workbench(top = 0.9): PieceGeometry {
  const b = new PartBuilder(305);
  const w = 1.8;
  const d = 0.8;
  b.box([w, 0.07, d], [0, top - 0.035, 0], LAIR.crate, { jitter: 0.12 });
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      b.box(
        [0.06, top - 0.07, 0.06],
        [x * (w / 2 - 0.06), (top - 0.07) / 2, z * (d / 2 - 0.06)],
        LAIR.steelPaint,
      );
  b.box([w - 0.1, 0.03, d - 0.1], [0, 0.18, 0], LAIR.steelDark);
  b.box([0.5, 0.22, 0.3], [-0.45, 0.31, 0], LAIR.red);
  b.box([0.5, 0.04, 0.3], [-0.45, 0.43, 0], LAIR.steelDark);
  // The vice, a hammer and a coil of wire on the top.
  b.box([0.14, 0.1, 0.18], [w / 2 - 0.12, top + 0.05, d / 2 - 0.12], LAIR.steelDark);
  b.cylinder(0.012, 0.012, 0.2, 6, [w / 2 - 0.12, top + 0.08, d / 2 + 0.0], LAIR.chrome, {
    rot: [0, 0, Math.PI / 2],
  });
  b.box([0.26, 0.025, 0.03], [0.1, top + 0.012, 0.15], LAIR.walnut, { rot: [0, 0.4, 0] });
  b.box([0.04, 0.05, 0.08], [0.22, top + 0.025, 0.2], LAIR.steelDark, { rot: [0, 0.4, 0] });
  b.cylinder(0.08, 0.08, 0.04, 10, [-0.5, top + 0.02, -0.2], LAIR.orange);
  return { body: b.build() };
}

/** A steel-framed stool with a low back: seat 0.33 m, back top 0.72 m (the #163 seated fit). */
const STOOL = { seat: 0.33, back: 0.72, backZ: -0.17 } as const;
export const STOOL_SEAT: SitPoints = {
  seatY: STOOL.seat,
  backFrontZ: STOOL.backZ + 0.02,
  backTopY: STOOL.back,
};

export function stoolChair(): PieceGeometry {
  const b = new PartBuilder(306);
  for (const [x, z] of [
    [-0.17, -0.17],
    [0.17, -0.17],
    [0.17, 0.17],
    [-0.17, 0.17],
  ] as const) {
    b.cylinder(
      0.015,
      0.018,
      STOOL.seat - 0.04,
      6,
      [x, (STOOL.seat - 0.04) / 2, z],
      LAIR.steelLight,
      { smooth: true },
    );
  }
  b.box([0.38, 0.015, 0.015], [0, 0.12, 0.17], LAIR.steelLight);
  b.cylinder(0.22, 0.2, 0.05, 12, [0, STOOL.seat - 0.025, 0], LAIR.teal);
  b.box(
    [0.03, STOOL.back - STOOL.seat, 0.025],
    [0, (STOOL.back + STOOL.seat) / 2, STOOL.backZ - 0.03],
    LAIR.steelLight,
  );
  b.box([0.34, 0.16, 0.04], [0, STOOL.back - 0.08, STOOL.backZ], LAIR.teal, { rot: [-0.1, 0, 0] });
  return { body: b.build() };
}

/** The war room's button-backed leather chair with arms: seat 0.33 m, back top 0.82 m. */
const LEATHER = { seat: 0.33, back: 0.82, backZ: -0.2, w: 0.6, arm: 0.07 } as const;
export const LEATHER_SEAT: SitPoints = {
  seatY: LEATHER.seat,
  backFrontZ: LEATHER.backZ + 0.05,
  backTopY: LEATHER.back,
  armInnerX: LEATHER.w / 2 - LEATHER.arm,
};

export function leatherChair(): PieceGeometry {
  const b = new PartBuilder(307);
  const { seat, back, backZ, w, arm } = LEATHER;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.box([0.05, 0.035, 0.26], [Math.sin(a) * 0.13, 0.0175, Math.cos(a) * 0.13], LAIR.brass, {
      rot: [0, a, 0],
    });
  }
  b.cylinder(0.03, 0.03, seat - 0.1, 8, [0, 0.035 + (seat - 0.1) / 2, 0], LAIR.brass, {
    smooth: true,
  });
  b.box([w - 2 * arm, 0.09, 0.46], [0, seat - 0.045, 0.02], "#5A2A1C", { jitter: 0.1 });
  b.box([w, back - seat + 0.06, 0.1], [0, (back + seat) / 2 - 0.03, backZ], "#5A2A1C", {
    rot: [-0.06, 0, 0],
    jitter: 0.1,
  });
  for (const side of [-1, 1])
    b.box([arm, 0.2, 0.44], [side * (w / 2 - arm / 2), seat + 0.06, 0.0], "#4A2216");
  // Button tufting: brass studs on the back.
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++)
      b.sphere(0.012, 4, 3, [-0.12 + c * 0.12, seat + 0.2 + r * 0.16, backZ + 0.055], LAIR.brass);
  return { body: b.build() };
}

/** A walnut map chest, 1.2 x 0.8 x 0.6 m: shallow drawers with brass pulls, a rolled map on top. */
export function mapChest(): PieceGeometry {
  const b = new PartBuilder(308);
  b.box([1.2, 0.8, 0.6], [0, 0.4, 0], LAIR.walnut, { jitter: 0.06 });
  for (let k = 0; k < 5; k++) {
    const y = 0.1 + k * 0.145;
    b.panelZ(-0.56, y - 0.055, 0.56, y + 0.055, 0.301, LAIR.walnutDark);
    b.box([0.16, 0.02, 0.02], [0, y, 0.31], LAIR.brass);
  }
  b.cylinder(0.04, 0.04, 0.9, 8, [0, 0.84, 0.05], "#D8C49A", {
    rot: [0, 0, Math.PI / 2],
    smooth: true,
  });
  return { body: b.build() };
}

/** A rolling red tool chest, 0.7 x 1.0 x 0.5 m, with a wrench on top. */
export function toolChest(): PieceGeometry {
  const b = new PartBuilder(309);
  b.box([0.7, 0.88, 0.5], [0, 0.52, 0], LAIR.red, { jitter: 0.06 });
  for (let k = 0; k < 6; k++) {
    const y = 0.15 + k * 0.14 + 0.06;
    b.panelZ(-0.33, y - 0.055, 0.33, y + 0.055, 0.251, "#B81F33");
    b.box([0.4, 0.015, 0.02], [0, y + 0.03, 0.26], LAIR.chrome);
  }
  for (const x of [-0.28, 0.28])
    for (const z of [-0.18, 0.18]) b.sphere(0.04, 6, 4, [x, 0.04, z], LAIR.black);
  b.box([0.3, 0.02, 0.04], [0.05, 0.97, 0], LAIR.chrome, { rot: [0, 0.5, 0] });
  return { body: b.build() };
}

// ---- Style plants -------------------------------------------------------------------

export function seedlingTray(): PieceGeometry {
  const b = new PartBuilder(310);
  for (const [x, z] of [
    [-0.2, -0.13],
    [0.2, -0.13],
    [0.2, 0.13],
    [-0.2, 0.13],
  ] as const)
    b.box([0.025, 0.3, 0.025], [x, 0.15, z], LAIR.steelLight);
  b.box([0.48, 0.06, 0.32], [0, 0.32, 0], LAIR.black);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const x = -0.17 + i * 0.11;
      const z = -0.1 + j * 0.1;
      frond(b, [x, 0.35, z], i + j, -0.03, 0.05, LAIR.leafLight);
      frond(b, [x, 0.35, z], i + j + Math.PI, -0.03, 0.05, LAIR.leaf);
    }
  return { body: b.build() };
}

export function cactusTin(): PieceGeometry {
  const b = new PartBuilder(311);
  b.cylinder(0.12, 0.12, 0.18, 10, [0, 0.09, 0], LAIR.steelLight, { smooth: true });
  b.cylinder(0.1, 0.1, 0.07, 10, [0, 0.12, 0], LAIR.red, { smooth: true });
  b.cylinder(0.05, 0.06, 0.32, 8, [0, 0.34, 0], LAIR.leaf, { smooth: true });
  b.sphere(0.05, 8, 4, [0, 0.5, 0], LAIR.leaf, { smooth: true });
  b.cylinder(0.03, 0.03, 0.12, 6, [0.08, 0.36, 0], LAIR.leafLight, {
    rot: [0, 0, -0.9],
    smooth: true,
  });
  b.sphere(0.012, 4, 3, [0, 0.555, 0], LAIR.orange);
  return { body: b.build() };
}

/** A palm growing in a cut-down oil drum (the workshop's idea of a planter). */
export function drumPlanter(): PieceGeometry {
  const b = new PartBuilder(312);
  b.cylinder(0.29, 0.29, 0.55, 14, [0, 0.275, 0], LAIR.yellow, { smooth: true, jitter: 0.06 });
  for (const y of [0.04, 0.3, 0.53])
    b.cylinder(0.3, 0.3, 0.03, 14, [0, y, 0], LAIR.steelDark, { smooth: true });
  b.cylinder(0.27, 0.27, 0.02, 14, [0, 0.53, 0], LAIR.soil);
  b.cylinder(0.05, 0.06, 0.7, 6, [0, 0.9, 0], "#7A5C3A");
  for (let k = 0; k < 8; k++)
    frond(
      b,
      [0, 1.25, 0],
      (k / 8) * Math.PI * 2,
      0.35,
      0.75,
      [LAIR.leaf, LAIR.leafDark, LAIR.leafLight][k % 3] ?? LAIR.leaf,
    );
  return { body: b.build() };
}

// ---- Floors ---------------------------------------------------------------------------

/** Lab floor: a tile of 0.5 m white ceramic tiles with grey grout. */
export function tileFloor(): PieceGeometry {
  const b = new PartBuilder(313);
  const H = TILE / 2;
  b.box([TILE, 0.08, TILE], [0, -0.044, 0], LAIR.concreteDark);
  const n = 4;
  const s = TILE / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x0 = -H + i * s;
      const z0 = -H + j * s;
      b.panelY(
        x0 + 0.012,
        z0 + 0.012,
        x0 + s - 0.012,
        z0 + s - 0.012,
        0,
        "#D9DEDF",
        0.92 + b.random() * 0.08,
      );
    }
  b.panelY(-H, -H, H, H, -0.002, "#8D9395");
  return { body: b.build() };
}

/** War-room floor: dark red carpet with a brass-gold border line along two edges (it tiles). */
export function carpetFloor(): PieceGeometry {
  const b = new PartBuilder(314);
  const H = TILE / 2;
  b.box([TILE, 0.08, TILE], [0, -0.044, 0], "#2E1A18");
  b.panelY(-H, -H, H, H, 0, "#5A2A26", 0.95);
  b.panelY(-H, -H, H, -H + 0.04, 0.001, "#8A6A2A");
  b.panelY(-H, -H, -H + 0.04, H, 0.001, "#8A6A2A");
  // Worn patches where chairs roll.
  b.panelY(-0.4, 0.1, 0.3, 0.6, 0.001, "#4E2420");
  return { body: b.build() };
}
