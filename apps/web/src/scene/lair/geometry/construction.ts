/**
 * Build-phase pieces (#183, SPEC §9.1 "scaffolding, crates, sparks, dust"):
 * a one-tile scaffold bay with planks, braces and a ladder, a striped
 * A-frame barrier, a tripod work light, a stack of supply crates and a cable
 * drum. The sparks and dust are particles (particles/), not geometry.
 */
import { CylinderGeometry } from "three";
import { TILE, WALL_HEIGHT } from "../dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";
import { crate } from "./storage.ts";

const TUBE = 0.035;

function tube(
  b: PartBuilder,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  color: string,
) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  const mid: [number, number, number] = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ];
  // Cylinder along y, turned to the segment: pitch about x first, then yaw about y.
  const pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
  const yaw = Math.atan2(dx, dz);
  const geo = new CylinderGeometry(TUBE / 2, TUBE / 2, len, 5, 1, true);
  geo.rotateX(pitch);
  geo.rotateY(yaw);
  b.add(geo, mid, color, { smooth: true });
}

/** One scaffold bay, a tile square and wall-high, standards in yellow, two plank lifts. */
export function scaffold(): PieceGeometry {
  const b = new PartBuilder(111);
  const s = TILE / 2 - 0.1;
  const h = WALL_HEIGHT + 0.2;
  const corners = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ] as const;
  for (const [x, z] of corners) {
    tube(b, [x, 0, z], [x, h, z], LAIR.yellow);
    b.box([0.14, 0.02, 0.14], [x, 0.01, z], LAIR.steelDark);
  }
  for (const y of [1.2, 2.4]) {
    for (let i = 0; i < 4; i++) {
      const a = corners[i] ?? corners[0];
      const c = corners[(i + 1) % 4] ?? corners[0];
      tube(b, [a[0], y, a[1]], [c[0], y, c[1]], LAIR.steelLight);
    }
    // Planks across the lift, with a toe board.
    for (let k = 0; k < 4; k++)
      b.box([2 * s, 0.04, 0.22], [0, y + 0.04, -s + 0.15 + k * 0.24], LAIR.crate, { jitter: 0.2 });
    b.box([2 * s, 0.14, 0.03], [0, y + 0.1, s], LAIR.crate);
  }
  // Diagonal braces on two faces.
  tube(b, [-s, 0.1, -s], [s, 2.4, -s], LAIR.steelLight);
  tube(b, [s, 0.1, -s], [s, 2.4, s], LAIR.steelLight);
  // A ladder up the open side.
  for (const x of [-0.2, 0.2]) tube(b, [x, 0, s + 0.12], [x, 2.6, s + 0.05], LAIR.steel);
  for (let y = 0.3; y < 2.5; y += 0.3)
    tube(b, [-0.2, y, s + 0.115 - y * 0.027], [0.2, y, s + 0.115 - y * 0.027], LAIR.steel);
  // Kit left on the top lift: a bucket and a coil of cable.
  b.cylinder(0.12, 0.1, 0.22, 8, [0.4, 2.55, -0.2], LAIR.steelPaint);
  b.cylinder(0.18, 0.18, 0.06, 10, [-0.35, 2.47, 0.1], LAIR.black);
  return { body: b.build() };
}

/** A striped A-frame barrier, 1.2 m long, with a red lamp on top (glow). */
export function barrier(): PieceGeometry {
  const b = new PartBuilder(112);
  const glow = new PartBuilder(113);
  for (const side of [-1, 1]) {
    tube(b, [side * 0.55, 0, -0.2], [side * 0.55, 1.0, 0], LAIR.steelDark);
    tube(b, [side * 0.55, 0, 0.2], [side * 0.55, 1.0, 0], LAIR.steelDark);
  }
  const stripe = new PartBuilder(114).hazardZ(-0.6, -0.1, 0.6, 0.1, 0, 8).build();
  b.append(stripe, [0, 0.85, 0.02]);
  b.append(stripe, [0, 0.85, -0.02], [0, Math.PI, 0]);
  b.append(stripe, [0, 0.45, 0.11]);
  b.append(stripe, [0, 0.45, -0.11], [0, Math.PI, 0]);
  stripe.dispose();
  b.box([1.2, 0.2, 0.03], [0, 0.85, 0], LAIR.black);
  b.box([1.2, 0.2, 0.03], [0, 0.45, 0], LAIR.black, { scale: [1, 1, 1] });
  b.cylinder(0.05, 0.05, 0.04, 8, [0.5, 0.97, 0], LAIR.steelDark);
  glow.sphere(0.05, 8, 5, [0.5, 1.02, 0], LAIR.red, { smooth: true });
  return { body: b.build(), glow: glow.build() };
}

/** A tripod work light, 1.8 m, its lamp head tilted down toward +z. */
export function workLight(): PieceGeometry {
  const b = new PartBuilder(115);
  const glow = new PartBuilder(116);
  const top = 1.7;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    tube(b, [Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45], [0, 0.9, 0], LAIR.yellow);
  }
  tube(b, [0, 0.85, 0], [0, top, 0], LAIR.steelLight);
  b.box([0.36, 0.28, 0.16], [0, top + 0.1, 0.02], LAIR.yellow, { rot: [0.5, 0, 0] });
  glow.box([0.3, 0.22, 0.02], [0, top + 0.06, 0.1], LAIR.tungstenGlow, { rot: [0.5, 0, 0] });
  b.cylinder(0.012, 0.012, 1.0, 4, [0.05, 0.4, 0.2], LAIR.black, { rot: [0.4, 0, 0] });
  return { body: b.build(), glow: glow.build() };
}

/** Three supply crates, two on the floor and one on top, turned a little. */
export function crateStack(): PieceGeometry {
  const b = new PartBuilder(117);
  const parts = [crate(52), crate(57), crate(58)];
  const [c0, c1, c2] = parts.map((p) => p.body);
  if (c0) b.append(c0, [-0.43, 0, 0], [0, 0.05, 0]);
  if (c1) b.append(c1, [0.43, 0, 0.05], [0, -0.12, 0]);
  if (c2) b.append(c2, [0.05, 0.8, 0.02], [0, 0.35, 0], [0.85, 0.85, 0.85]);
  for (const p of parts) p.body.dispose();
  return { body: b.build() };
}

/** A wooden cable drum on its side with cable wound on it. */
export function cableDrum(): PieceGeometry {
  const b = new PartBuilder(118);
  for (const z of [-0.25, 0.25])
    b.cylinder(0.45, 0.45, 0.05, 12, [0, 0.45, z], LAIR.crate, { rot: [Math.PI / 2, 0, 0] });
  b.cylinder(0.32, 0.32, 0.46, 12, [0, 0.45, 0], LAIR.black, {
    rot: [Math.PI / 2, 0, 0],
    smooth: true,
  });
  b.cylinder(0.08, 0.08, 0.56, 8, [0, 0.45, 0], LAIR.steelDark, { rot: [Math.PI / 2, 0, 0] });
  b.cylinder(0.025, 0.025, 0.8, 5, [0.6, 0.05, 0.1], LAIR.black, {
    rot: [0, 0, Math.PI / 2 - 0.1],
  });
  return { body: b.build() };
}
