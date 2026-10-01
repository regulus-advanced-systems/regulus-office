/**
 * Floor tiles (#183), one grid tile (2 m) square, top at y = 0: poured
 * concrete with saw-cut joints, oil stains and scuffs (lived-in, never
 * sterile), riveted steel deck plate with a raised tread, and a hazard
 * strip for corridor edges and door thresholds.
 */
import { TILE } from "../dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

const S = TILE;
const HALF = S / 2;
const SLAB = 0.08;

function slab(b: PartBuilder, color: string): void {
  // Only the sides below the top: the top is drawn in patches.
  b.box([S, SLAB, S], [0, -SLAB / 2 - 0.004, 0], color);
}

/** Poured concrete; `worn` adds an oil stain and a scuff (use it on some tiles, not all). */
export function concreteFloor(seed = 11, worn = false): PieceGeometry {
  const b = new PartBuilder(seed);
  slab(b, LAIR.concreteDark);
  // Four pours, each a slightly different tone.
  const n = 2;
  const cell = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = -HALF + i * cell;
      const z0 = -HALF + j * cell;
      b.panelY(x0, z0, x0 + cell, z0 + cell, 0, LAIR.concrete, 0.86 + b.random() * 0.1);
    }
  }
  // Saw-cut joints along the tile edges and through the middle.
  for (const x of [-HALF, 0, HALF])
    b.panelY(x - 0.012, -HALF, x + 0.012, HALF, 0.002, LAIR.concreteDark);
  for (const z of [-HALF, 0, HALF])
    b.panelY(-HALF, z - 0.012, HALF, z + 0.012, 0.002, LAIR.concreteDark);
  if (!worn) return { body: b.build() };
  // An oil stain (an irregular fan of triangles) and a scuff.
  const cx = -0.35 + b.random() * 0.7;
  const cz = -0.35 + b.random() * 0.7;
  const spokes = 9;
  for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2;
    const a1 = ((k + 1) / spokes) * Math.PI * 2;
    const r0 = 0.22 + b.random() * 0.1;
    const r1 = 0.22 + b.random() * 0.1;
    b.tri(
      [cx, 0.003, cz],
      [cx + Math.cos(a1) * r1, 0.003, cz + Math.sin(a1) * r1 * 0.7],
      [cx + Math.cos(a0) * r0, 0.003, cz + Math.sin(a0) * r0 * 0.7],
      LAIR.concreteDark,
      0.95,
    );
  }
  b.panelY(0.3, 0.55, 0.85, 0.58, 0.003, LAIR.concreteDark, 1.05);
  return { body: b.build() };
}

export function steelFloor(seed = 12): PieceGeometry {
  const b = new PartBuilder(seed);
  slab(b, LAIR.steelDark);
  // Two deck plates with a seam between them.
  for (const x0 of [-HALF, 0])
    b.panelY(x0 + 0.01, -HALF, x0 + HALF - 0.01, HALF, 0, LAIR.steel, 0.82 + b.random() * 0.12);
  b.panelY(-0.01, -HALF, 0.01, HALF, -0.001, LAIR.black);
  // Raised tread: small diamonds, alternate rows offset.
  const step = 0.25;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const x =
        -HALF + step / 2 + c * step + (r % 2 === 0 ? 0 : step / 2) - (r % 2 === 0 ? 0 : step / 4);
      const z = -HALF + step / 2 + r * step;
      if (Math.abs(x) < 0.05 || x > HALF - 0.06) continue;
      const d = 0.045;
      b.quad(
        [x, 0.004, z + d],
        [x + d * 0.5, 0.004, z],
        [x, 0.004, z - d],
        [x - d * 0.5, 0.004, z],
        LAIR.steelLight,
        0.9,
      );
    }
  }
  // Countersunk bolts in the plate corners.
  for (const x of [-HALF + 0.06, -0.06, 0.06, HALF - 0.06]) {
    for (const z of [-HALF + 0.06, HALF - 0.06]) {
      b.panelY(x - 0.018, z - 0.018, x + 0.018, z + 0.018, 0.003, LAIR.steelDark);
    }
  }
  return { body: b.build() };
}

/** A 2 m hazard strip (0.3 m wide), flat on the floor, along x, for edges and thresholds. */
export function hazardStrip(): PieceGeometry {
  const b = new PartBuilder(13);
  const stripes = new PartBuilder(14).hazardZ(-HALF, -0.15, HALF, 0.15, 0, 10).build();
  // Lay the +z-facing stripes flat, facing up.
  b.append(stripes, [0, 0.004, 0], [-Math.PI / 2, 0, 0]);
  stripes.dispose();
  return { body: b.build() };
}
