/**
 * Storage and clutter (#183): a bank of henchman lockers, wooden supply
 * crates, oil drums, and plants so the rock never feels sterile (owner
 * preference: spacious but lived-in): a potted island palm, a fern in a
 * concrete pot and a long planter. Fronts toward +z.
 */
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

export function lockers(): PieceGeometry {
  const b = new PartBuilder(51);
  const n = 3;
  const w = 0.42;
  const h = 1.85;
  const d = 0.5;
  b.box([n * w + 0.04, 0.1, d], [0, 0.05, 0], LAIR.black);
  b.box([n * w + 0.04, 0.04, d + 0.02], [0, h + 0.02, 0], LAIR.steelDark);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * w;
    b.box([w - 0.01, h - 0.1, d], [x, 0.1 + (h - 0.1) / 2, 0], LAIR.olive, { jitter: 0.08 });
    // Door: vent louvres up top, a name card, a handle; one left ajar would need a hinge, so a dent will do.
    for (let k = 0; k < 4; k++)
      b.panelZ(x - 0.12, 1.6 - k * 0.06, x + 0.12, 1.62 - k * 0.06, d / 2 + 0.001, LAIR.black);
    b.panelZ(x - 0.08, 1.25, x + 0.08, 1.33, d / 2 + 0.001, LAIR.cream);
    b.box([0.03, 0.12, 0.03], [x + w / 2 - 0.07, 1.0, d / 2 + 0.015], LAIR.chrome);
    b.panelZ(x - w / 2 + 0.005, 0.1, x - w / 2 + 0.012, h, d / 2 + 0.001, LAIR.black);
  }
  // A hard hat left on top.
  b.sphere(0.13, 10, 5, [0.25, h + 0.04, 0.02], LAIR.yellow, { scale: [1, 0.75, 1.1] });
  b.cylinder(0.17, 0.17, 0.015, 12, [0.25, h + 0.045, 0.02], LAIR.yellow);
  return { body: b.build() };
}

/** A slatted wooden supply crate, 0.8 m, with steel corner caps and a stencil band. */
export function crate(seed = 52): PieceGeometry {
  const b = new PartBuilder(seed);
  const s = 0.8;
  b.box([s - 0.04, s - 0.04, s - 0.04], [0, s / 2, 0], LAIR.crateDark);
  // Slats on the four sides and the lid.
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const part = new PartBuilder(seed + k + 1);
    for (let i = 0; i < 4; i++) {
      const y0 = 0.02 + i * 0.19;
      part.box([s - 0.1, 0.17, 0.03], [0, y0 + 0.085, 0], LAIR.crate, { jitter: 0.15 });
    }
    part.box([0.08, s, 0.04], [-s / 2 + 0.04, s / 2, 0.01], LAIR.crateDark);
    part.box([0.08, s, 0.04], [s / 2 - 0.04, s / 2, 0.01], LAIR.crateDark);
    part.box([s - 0.1, 0.06, 0.035], [0, s / 2, 0.012], LAIR.crateDark, { rot: [0, 0, 0.75] });
    part.panelZ(-0.18, 0.5, 0.18, 0.58, 0.03, LAIR.black, 0.9);
    const g = part.build();
    b.append(g, [Math.sin(yaw) * (s / 2 - 0.015), 0, Math.cos(yaw) * (s / 2 - 0.015)], [0, yaw, 0]);
    g.dispose();
  }
  for (let i = 0; i < 4; i++)
    b.box([s - 0.06, 0.03, 0.17], [0, s, -0.29 + i * 0.19], LAIR.crate, { jitter: 0.15 });
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      b.box([0.09, 0.09, 0.09], [x * (s / 2 - 0.03), s - 0.03, z * (s / 2 - 0.03)], LAIR.steelDark);
  return { body: b.build() };
}

/** A 200 l oil drum: ribbed steel, painted (tint per instance), a hazard band and a bung. */
export function barrel(): PieceGeometry {
  const b = new PartBuilder(53);
  const r = 0.29;
  const h = 0.88;
  b.cylinder(r, r, h, 14, [0, h / 2, 0], LAIR.red, { smooth: true, jitter: 0.05 });
  for (const y of [0.04, h / 3, (2 * h) / 3, h - 0.04])
    b.cylinder(r + 0.012, r + 0.012, 0.035, 14, [0, y, 0], LAIR.steelDark, { smooth: true });
  b.cylinder(r + 0.004, r + 0.004, 0.12, 14, [0, h / 2, 0], LAIR.yellow, { smooth: true });
  b.cylinder(r - 0.02, r - 0.02, 0.01, 14, [0, h + 0.002, 0], LAIR.steel);
  b.cylinder(0.03, 0.03, 0.02, 6, [0.15, h + 0.01, 0.05], LAIR.steelDark);
  return { body: b.build() };
}

function frond(
  b: PartBuilder,
  base: [number, number, number],
  yaw: number,
  droop: number,
  len: number,
  color: string,
) {
  // A fan leaf: a flat diamond tilted out and down, split into two facets along its spine.
  const dirX = Math.sin(yaw);
  const dirZ = Math.cos(yaw);
  const sideX = Math.cos(yaw);
  const sideZ = -Math.sin(yaw);
  const tip: [number, number, number] = [
    base[0] + dirX * len,
    base[1] - droop,
    base[2] + dirZ * len,
  ];
  const mid = 0.45;
  const wid = len * 0.32;
  const m: [number, number, number] = [
    base[0] + dirX * len * mid,
    base[1] + 0.08 - droop * 0.3,
    base[2] + dirZ * len * mid,
  ];
  const l: [number, number, number] = [m[0] + sideX * wid, m[1] - 0.04, m[2] + sideZ * wid];
  const r: [number, number, number] = [m[0] - sideX * wid, m[1] - 0.04, m[2] - sideZ * wid];
  // Both windings so a leaf is visible from above and below.
  b.tri(base, l, m, color)
    .tri(m, l, tip, color, 1.08)
    .tri(base, m, r, color, 0.9)
    .tri(m, tip, r, color);
  b.tri(base, m, l, color, 0.8)
    .tri(m, tip, l, color, 0.8)
    .tri(base, r, m, color, 0.7)
    .tri(m, r, tip, color, 0.75);
}

/** An island palm in a big terracotta pot, about 1.6 m. */
export function pottedPalm(seed = 54): PieceGeometry {
  const b = new PartBuilder(seed);
  b.cylinder(0.3, 0.22, 0.45, 10, [0, 0.225, 0], LAIR.terracotta, { jitter: 0.08 });
  b.cylinder(0.32, 0.32, 0.06, 10, [0, 0.45, 0], LAIR.terracotta);
  b.cylinder(0.28, 0.28, 0.02, 10, [0, 0.46, 0], LAIR.soil);
  // A slightly curved trunk in three ringed sections.
  let y = 0.46;
  let x = 0;
  for (let i = 0; i < 4; i++) {
    const seg = 0.26;
    b.cylinder(0.055 - i * 0.006, 0.065 - i * 0.006, seg, 6, [x, y + seg / 2, 0], "#7A5C3A", {
      rot: [0, 0, -0.08 * i],
    });
    y += seg * 0.97;
    x += 0.02 * i;
  }
  const crown: [number, number, number] = [x, y, 0];
  const leaves = 9;
  for (let k = 0; k < leaves; k++) {
    const yaw = (k / leaves) * Math.PI * 2 + b.random() * 0.3;
    const tone = [LAIR.leaf, LAIR.leafDark, LAIR.leafLight][k % 3] ?? LAIR.leaf;
    frond(b, crown, yaw, 0.35 + b.random() * 0.25, 0.75 + b.random() * 0.2, tone);
  }
  return { body: b.build() };
}

/** A fern bush in a squat concrete pot, about 0.7 m. */
export function pottedFern(seed = 55): PieceGeometry {
  const b = new PartBuilder(seed);
  b.cylinder(0.24, 0.2, 0.3, 8, [0, 0.15, 0], LAIR.concrete, { jitter: 0.1 });
  b.cylinder(0.21, 0.21, 0.02, 8, [0, 0.3, 0], LAIR.soil);
  for (let k = 0; k < 11; k++) {
    const yaw = (k / 11) * Math.PI * 2 + b.random() * 0.4;
    const tone = [LAIR.leaf, LAIR.leafLight, LAIR.leafDark][k % 3] ?? LAIR.leaf;
    frond(b, [0, 0.32, 0], yaw, 0.05 - b.random() * 0.2, 0.38 + b.random() * 0.12, tone);
  }
  return { body: b.build() };
}

/** A long concrete planter with low shrubs, 1.6 x 0.5 m. */
export function planter(seed = 56): PieceGeometry {
  const b = new PartBuilder(seed);
  b.box([1.6, 0.42, 0.5], [0, 0.21, 0], LAIR.concrete, { jitter: 0.1 });
  b.box([1.64, 0.04, 0.54], [0, 0.42, 0], LAIR.concreteDark);
  b.box([1.5, 0.02, 0.4], [0, 0.43, 0], LAIR.soil);
  for (let i = 0; i < 6; i++) {
    const tone = [LAIR.leaf, LAIR.leafDark, LAIR.leafLight][i % 3] ?? LAIR.leaf;
    b.boulder(0.18 + b.random() * 0.06, [-0.62 + i * 0.25, 0.55, (b.random() - 0.5) * 0.12], tone, {
      lump: 0.35,
    });
  }
  return { body: b.build() };
}
