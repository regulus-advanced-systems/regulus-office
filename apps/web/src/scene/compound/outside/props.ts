/**
 * The beach's props (#188, SPEC §12, D23: original, procedural): the wooden
 * dock on its piles with bollards, a lamp, a life ring and some cargo; palms;
 * boulders; and a little lived-in clutter (striped deck chairs and a
 * parasol). Everything static is baked into ONE vertex-coloured mesh plus
 * one glow mesh for the lamp bulb, in compound metres. Pure.
 */
import { TorusGeometry } from "three";
import { PartBuilder, type PieceGeometry, type Vec3 } from "../../lair/geometry/builder.ts";
import { LAIR } from "../../lair/palette.ts";
import type { Boulder, OutsideLayout, Palm } from "./layout.ts";
import { SEA_LEVEL } from "./layout.ts";

const WOOD = { plank: "#A57E52", plankDark: "#7E5E3A", pile: "#5E4630", rope: "#C9B07A" } as const;
const PALM = {
  trunk: "#8A6A47",
  ring: "#6E5236",
  frond: "#3E8A3A",
  frondDark: "#2C6A2E",
  nut: "#5A3E22",
} as const;
const DECK_TOP = 0;
const PLANK_T = 0.07;

function dock(b: PartBuilder, glow: PartBuilder, layout: OutsideLayout): void {
  const { dock: d } = layout;
  const cx = d.x + d.w / 2;
  // Deck planks across the dock, with a hint of a gap and per-plank colour.
  for (let z = d.z; z < d.z + d.d - 0.01; z += 0.3) {
    const color = b.random() > 0.7 ? WOOD.plankDark : WOOD.plank;
    b.box([d.w, PLANK_T, 0.27], [cx, DECK_TOP - PLANK_T / 2, z + 0.15], color, { jitter: 0.1 });
  }
  // Stringers and piles, the end piles standing proud as bollards.
  for (const side of [-1, 1]) {
    const x = cx + side * (d.w / 2 - 0.12);
    b.box([0.14, 0.18, d.d], [x, DECK_TOP - PLANK_T - 0.09, d.z + d.d / 2], WOOD.pile);
    for (let z = d.z + 1.2; z <= d.z + d.d - 0.1; z += 2.4) {
      const last = z + 2.4 > d.z + d.d - 0.1;
      const top = last ? DECK_TOP + 0.55 : DECK_TOP - 0.02;
      const bottom = SEA_LEVEL - 1.6;
      b.cylinder(0.13, 0.15, top - bottom, 7, [x + side * 0.08, (top + bottom) / 2, z], WOOD.pile, {
        jitter: 0.1,
      });
      if (last) b.cylinder(0.15, 0.15, 0.06, 7, [x + side * 0.08, top, z], WOOD.rope);
    }
  }
  // A lamp post at the end.
  const lampX = d.x + 0.25;
  const lampZ = d.z + d.d - 0.6;
  b.cylinder(0.05, 0.07, 2.6, 6, [lampX, 1.3, lampZ], LAIR.steelDark);
  b.box([0.5, 0.05, 0.05], [lampX + 0.22, 2.58, lampZ], LAIR.steelDark);
  b.cone(0.2, 0.18, 8, [lampX + 0.45, 2.5, lampZ], LAIR.steel);
  glow.sphere(0.11, 8, 6, [lampX + 0.45, 2.38, lampZ], LAIR.tungstenGlow);
  // A life ring on a post half way along, cargo at the root.
  const ringZ = d.z + d.d * 0.55;
  b.box([0.08, 1.1, 0.08], [d.x + d.w - 0.1, 0.55, ringZ], WOOD.pile);
  b.add(new TorusGeometry(0.3, 0.08, 5, 10), [d.x + d.w + 0.0, 0.75, ringZ], LAIR.red, {
    rot: [0, Math.PI / 2, 0],
  });
  b.box([0.12, 0.17, 0.17], [d.x + d.w, 1.05, ringZ], "#F2EEE4");
  b.box([0.7, 0.6, 0.7], [d.x + 0.55, 0.3, d.z + 1.6], LAIR.crate, {
    jitter: 0.12,
    rot: [0, 0.2, 0],
  });
  b.box([0.6, 0.5, 0.6], [d.x + 0.6, 0.85, d.z + 1.55], LAIR.crateDark, {
    jitter: 0.12,
    rot: [0, -0.3, 0],
  });
  b.cylinder(0.3, 0.3, 0.9, 9, [d.x + d.w - 0.45, 0.45, d.z + 2.4], LAIR.olive, { jitter: 0.08 });
  // A coil of rope.
  b.cylinder(0.3, 0.3, 0.12, 9, [d.x + d.w - 0.5, 0.06, d.z + d.d - 1.4], WOOD.rope);
}

function palm(b: PartBuilder, p: Palm): void {
  const segs = 6;
  const dx = Math.sin(p.lean);
  const dz = Math.cos(p.lean);
  let prev: Vec3 = [p.x, 0, p.z];
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    // The trunk curves: it leans more toward the top.
    const off = p.height * 0.28 * t * t;
    const next: Vec3 = [p.x + dx * off, p.height * t, p.z + dz * off];
    const mid: Vec3 = [(prev[0] + next[0]) / 2, (prev[1] + next[1]) / 2, (prev[2] + next[2]) / 2];
    const len = Math.hypot(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    const tilt = Math.atan2(Math.hypot(next[0] - prev[0], next[2] - prev[2]), next[1] - prev[1]);
    const r = 0.2 - t * 0.08;
    b.cylinder(r * 0.9, r, len, 6, mid, i % 2 ? PALM.trunk : PALM.ring, {
      rot: [tilt * dz, 0, -tilt * dx],
      jitter: 0.08,
    });
    prev = next;
  }
  const top = prev;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + p.seed;
    b.sphere(
      0.13,
      5,
      4,
      [top[0] + Math.sin(a) * 0.16, top[1] - 0.15, top[2] + Math.cos(a) * 0.16],
      PALM.nut,
    );
  }
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const yaw = (i / fronds) * Math.PI * 2 + p.seed * 0.7;
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    const px = Math.cos(yaw);
    const pz = -Math.sin(yaw);
    const length = 2.4 + ((i * 37 + p.seed) % 5) * 0.12;
    const color = i % 2 ? PALM.frond : PALM.frondDark;
    // Three segments arcing out and drooping; each a flat leaf both ways up.
    let a: Vec3 = top;
    const pts = [0.33, 0.66, 1].map((t, k): [Vec3, number] => {
      const out = length * t;
      const drop = 0.35 * t + 1.1 * t * t;
      const w = [0.42, 0.34, 0.08][k] ?? 0.1;
      return [[top[0] + sx * out, top[1] + 0.25 * t - drop, top[2] + sz * out], w];
    });
    let wPrev = 0.12;
    for (const [pt, w] of pts) {
      const la: Vec3 = [a[0] - px * wPrev, a[1], a[2] - pz * wPrev];
      const ra: Vec3 = [a[0] + px * wPrev, a[1], a[2] + pz * wPrev];
      const lb: Vec3 = [pt[0] - px * w, pt[1] - 0.05, pt[2] - pz * w];
      const rb: Vec3 = [pt[0] + px * w, pt[1] - 0.05, pt[2] + pz * w];
      b.quad(la, lb, rb, ra, color);
      b.quad(ra, rb, lb, la, color, 0.8);
      a = pt;
      wPrev = w;
    }
  }
}

function boulder(b: PartBuilder, r: Boulder): void {
  const color = r.seed % 3 === 0 ? LAIR.rockCool : r.seed % 3 === 1 ? LAIR.rock : LAIR.rockLight;
  b.boulder(r.r, [r.x, r.r * r.h * 0.45, r.z], color, { scale: [1, r.h, 1], lump: 0.3 });
}

/** Two striped deck chairs and a parasol under the palms (`layout.lounge`). */
function clutter(b: PartBuilder, layout: OutsideLayout): void {
  const c = layout.lounge.x + layout.lounge.w / 2;
  const z = layout.lounge.z + layout.lounge.d / 2 + 0.4;
  for (const [x, stripe] of [
    [c - 0.8, LAIR.red],
    [c + 0.8, LAIR.yellow],
  ] as const) {
    const rot: Vec3 = [-0.55, 0.25, 0];
    b.box([0.6, 0.04, 1.2], [x, 0.35, z], stripe, { rot });
    b.box([0.2, 0.045, 1.2], [x, 0.36, z], "#F2EEE4", { rot });
    b.box([0.05, 0.4, 0.05], [x - 0.28, 0.2, z + 0.3], WOOD.plankDark);
    b.box([0.05, 0.4, 0.05], [x + 0.28, 0.2, z + 0.3], WOOD.plankDark);
  }
  const px = c;
  const pz = z - 1.1;
  b.cylinder(0.03, 0.03, 2.3, 5, [px, 1.15, pz], LAIR.chrome);
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    const rim = (a: number): Vec3 => [px + Math.sin(a) * 1.25, 1.95, pz + Math.cos(a) * 1.25];
    b.tri([px, 2.35, pz], rim(a0), rim(a1), i % 2 ? LAIR.red : "#F2EEE4");
    b.tri([px, 2.33, pz], rim(a1), rim(a0), i % 2 ? LAIR.red : "#F2EEE4", 0.7);
  }
}

/** The beach props: body and glow, compound metres. */
export function beachProps(layout: OutsideLayout): PieceGeometry {
  const b = new PartBuilder(4242);
  const glow = new PartBuilder(4243);
  dock(b, glow, layout);
  for (const p of layout.palms) palm(b, p);
  for (const r of layout.rocks) boulder(b, r);
  clutter(b, layout);
  return { body: b.build(), glow: glow.build() };
}
