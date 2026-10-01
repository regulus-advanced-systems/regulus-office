/**
 * Lair work furniture (#183): the henchman pod desk (sitters on both long
 * sides, a raised cable spine with a lamp strip down the middle), a lab
 * bench, the genius's walnut command desk with its big red button, the
 * war-room map table, a reception counter and the retro laptop. Authored at
 * nominal sizes; the scene scales each one to its obstacle footprint like
 * the Kenney models (`fitToFootprint`). Sitter / operator side toward +z.
 */
import { LAPTOP_DIMENSIONS } from "../../laptops/dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

export const DESK_HEIGHT = 0.76;

/** Four-seat pod desk, 1.6 x 1.2 m: symmetric, so both long sides are sitter sides. */
export function podDesk(): PieceGeometry {
  const b = new PartBuilder(61);
  const glow = new PartBuilder(62);
  const w = 1.6;
  const d = 1.2;
  const top = DESK_HEIGHT;
  b.box([w, 0.045, d], [0, top - 0.022, 0], LAIR.walnut, { jitter: 0.06 });
  b.box([w + 0.02, 0.02, d + 0.02], [0, top - 0.055, 0], LAIR.chrome);
  // Steel end panels for legs, a pedestal of drawers at each end on alternate sides.
  for (const side of [-1, 1]) {
    b.box(
      [0.05, top - 0.07, d - 0.1],
      [side * (w / 2 - 0.05), (top - 0.07) / 2, 0],
      LAIR.steelDark,
    );
    const px = side * (w / 2 - 0.27);
    const pz = side * (d / 4);
    b.box([0.4, top - 0.12, d / 2 - 0.1], [px, (top - 0.12) / 2 + 0.04, pz], LAIR.steelPaint, {
      jitter: 0.06,
    });
    for (let k = 0; k < 3; k++) {
      const y = 0.18 + k * 0.2;
      const fz = pz + side * ((d / 2 - 0.1) / 2 + 0.006);
      b.box([0.34, 0.16, 0.012], [px, y, fz], LAIR.steel);
      b.box([0.1, 0.02, 0.02], [px, y + 0.04, fz + side * 0.012], LAIR.brass);
    }
  }
  // The spine: cable trunking with a little lamp strip and paper trays.
  b.box([w - 0.2, 0.14, 0.12], [0, top + 0.07, 0], LAIR.steelDark);
  b.box([w - 0.16, 0.02, 0.16], [0, top + 0.15, 0], LAIR.steel);
  for (const side of [-1, 1])
    glow.box([w - 0.4, 0.02, 0.005], [0, top + 0.09, side * 0.062], LAIR.teal);
  // Personal clutter on the spine: a file tray, a mug, a framed photo.
  b.box([0.26, 0.05, 0.2], [-0.55, top + 0.185, 0], LAIR.black);
  b.box([0.22, 0.02, 0.17], [-0.55, top + 0.2, 0], LAIR.cream);
  b.cylinder(0.035, 0.03, 0.08, 8, [0.42, top + 0.2, 0.02], LAIR.orange, { smooth: true });
  b.box([0.1, 0.13, 0.015], [0.62, top + 0.225, 0], LAIR.brass, { rot: [0, 0.3, 0] });
  return { body: b.build(), glow: glow.build() };
}

/** A lab bench, 1.8 x 0.75 m: black epoxy top, steel frame, a shelf of jars and boxes. */
export function labBench(): PieceGeometry {
  const b = new PartBuilder(63);
  const w = 1.8;
  const d = 0.75;
  const top = DESK_HEIGHT;
  b.box([w, 0.04, d], [0, top - 0.02, 0], LAIR.black);
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      b.box(
        [0.05, top - 0.04, 0.05],
        [x * (w / 2 - 0.05), (top - 0.04) / 2, z * (d / 2 - 0.05)],
        LAIR.steel,
      );
  b.box([w - 0.1, 0.03, d - 0.1], [0, 0.2, 0], LAIR.steelDark);
  const jars = [LAIR.teal, LAIR.yellow, "#7CFC5A", LAIR.red];
  for (let i = 0; i < 6; i++) {
    b.cylinder(
      0.05,
      0.05,
      0.16,
      8,
      [-0.7 + i * 0.12, 0.3, -0.12],
      jars[i % jars.length] ?? LAIR.teal,
      { smooth: true },
    );
  }
  b.box([0.5, 0.2, 0.35], [0.5, 0.32, 0], LAIR.crate);
  // A microscope-ish brass instrument and a flask on top.
  b.cylinder(0.06, 0.08, 0.06, 8, [0.6, top + 0.03, -0.1], LAIR.black);
  b.cylinder(0.025, 0.025, 0.25, 8, [0.6, top + 0.17, -0.12], LAIR.brass, { rot: [0.25, 0, 0] });
  b.cone(0.08, 0.2, 8, [-0.5, top + 0.1, -0.1], LAIR.teal, { smooth: true });
  return { body: b.build() };
}

/** The genius's command desk, 2.2 x 1.0 m: walnut, a curved steel front, an inset panel and THE red button. */
export function commandDesk(): PieceGeometry {
  const b = new PartBuilder(64);
  const glow = new PartBuilder(65);
  const w = 2.2;
  const d = 1.0;
  const top = DESK_HEIGHT;
  b.box([w, 0.06, d], [0, top - 0.03, 0], LAIR.walnut, { jitter: 0.05 });
  b.box([w + 0.03, 0.025, d + 0.03], [0, top - 0.07, 0], LAIR.brass);
  // Curved facade on the visitor side (-z): half a drum, flattened.
  b.cylinder(w / 2, w / 2, top - 0.08, 16, [0, (top - 0.08) / 2, -0.05], LAIR.steelPaint, {
    scale: [1, 1, 0.36],
    jitter: 0.04,
  });
  b.box([w - 0.1, top - 0.08, d * 0.5], [0, (top - 0.08) / 2, 0.15], LAIR.walnutDark);
  b.cylinder(w / 2 + 0.01, w / 2 + 0.01, 0.06, 16, [0, top * 0.5, -0.05], LAIR.chrome, {
    scale: [1, 1, 0.37],
  });
  // Inset control panel on the sitter side.
  b.box([0.6, 0.02, 0.22], [0.55, top + 0.01, 0.28], LAIR.steelDark);
  for (let i = 0; i < 5; i++)
    b.box(
      [0.05, 0.02, 0.05],
      [0.36 + i * 0.09, top + 0.025, 0.24],
      [LAIR.yellow, LAIR.teal, LAIR.cream][i % 3] ?? LAIR.cream,
    );
  b.cylinder(0.06, 0.07, 0.03, 12, [0.6, top + 0.03, 0.33], LAIR.steelDark);
  glow.cylinder(0.045, 0.05, 0.04, 12, [0.6, top + 0.055, 0.33], LAIR.red);
  // Desk globe and a cigar box: a genius must have both.
  b.cylinder(0.08, 0.1, 0.04, 10, [-0.8, top + 0.02, -0.1], LAIR.brass);
  b.sphere(0.16, 10, 8, [-0.8, top + 0.22, -0.1], "#3D6E8C", { smooth: true });
  b.box([0.22, 0.06, 0.14], [-0.4, top + 0.03, 0.05], LAIR.walnutDark);
  return { body: b.build(), glow: glow.build() };
}

/** The war-room map table, 2.4 x 1.4 m: a steel frame with a glowing tactical map top and a brass rim. */
export function mapTable(): PieceGeometry {
  const b = new PartBuilder(66);
  const glow = new PartBuilder(67);
  const w = 2.4;
  const d = 1.4;
  const top = DESK_HEIGHT;
  b.box([w, top - 0.08, d], [0, (top - 0.08) / 2, 0], LAIR.steelDark, { scale: [0.86, 1, 0.8] });
  b.box([w, 0.08, d], [0, top - 0.04, 0], LAIR.steel);
  b.box([w + 0.04, 0.03, d + 0.04], [0, top + 0.005, 0], LAIR.brass);
  // The map: sea, an island and a grid, in the unlit layer so it glows.
  glow.panelY(-w / 2 + 0.06, -d / 2 + 0.06, w / 2 - 0.06, d / 2 - 0.06, top + 0.022, "#0F4C5C");
  const isle = 8;
  for (let k = 0; k < isle; k++) {
    const a0 = (k / isle) * Math.PI * 2;
    const a1 = ((k + 1) / isle) * Math.PI * 2;
    const r = (a: number) => 0.32 + 0.1 * Math.sin(a * 3);
    glow.tri(
      [-0.2, top + 0.024, 0.05],
      [-0.2 + Math.cos(a1) * r(a1) * 1.3, top + 0.024, 0.05 + Math.sin(a1) * r(a1)],
      [-0.2 + Math.cos(a0) * r(a0) * 1.3, top + 0.024, 0.05 + Math.sin(a0) * r(a0)],
      LAIR.teal,
    );
  }
  for (let i = 1; i < 8; i++) {
    const x = -w / 2 + (i * w) / 8;
    glow.panelY(x - 0.004, -d / 2 + 0.06, x + 0.004, d / 2 - 0.06, top + 0.026, "#2A8C8C");
  }
  for (let i = 1; i < 5; i++) {
    const z = -d / 2 + (i * d) / 5;
    glow.panelY(-w / 2 + 0.06, z - 0.004, w / 2 - 0.06, z + 0.004, top + 0.026, "#2A8C8C");
  }
  // Red target markers.
  for (const [x, z] of [
    [0.6, -0.3],
    [0.85, 0.25],
    [-0.75, -0.4],
  ] as const) {
    glow.cylinder(0.04, 0.04, 0.01, 8, [x, top + 0.03, z], LAIR.red);
  }
  return { body: b.build(), glow: glow.build() };
}

/** Reception counter, 2.0 x 0.8 m: steel, a walnut top, a yellow band and a lit name strip; visitors at -z. */
export function receptionCounter(): PieceGeometry {
  const b = new PartBuilder(68);
  const glow = new PartBuilder(69);
  const w = 2.0;
  const d = 0.8;
  b.box([w, 1.0, 0.12], [0, 0.5, -d / 2 + 0.06], LAIR.steelPaint, { jitter: 0.05 });
  b.box([w + 0.06, 0.05, 0.36], [0, 1.03, -d / 2 + 0.12], LAIR.walnut);
  b.box([w, 0.06, 0.125], [0, 0.32, -d / 2 + 0.06], LAIR.yellow);
  glow.box([w * 0.6, 0.06, 0.01], [0, 0.72, -d / 2 - 0.005], LAIR.tungstenGlow);
  b.box([w, 0.04, d - 0.1], [0, DESK_HEIGHT - 0.02, 0.05], LAIR.walnut);
  for (const x of [-1, 1])
    b.box(
      [0.08, DESK_HEIGHT, d - 0.1],
      [x * (w / 2 - 0.04), DESK_HEIGHT / 2, 0.05],
      LAIR.steelDark,
    );
  // A desk bell and a dial telephone.
  b.cylinder(0.04, 0.05, 0.04, 8, [0.6, 1.075, -d / 2 + 0.12], LAIR.brass, { smooth: true });
  b.box([0.2, 0.08, 0.16], [-0.5, DESK_HEIGHT + 0.04, 0.15], LAIR.red);
  return { body: b.build(), glow: glow.build() };
}

/**
 * A chunky retro laptop at the size of LAPTOP_DIMENSIONS: brass-hinged,
 * cream and gunmetal, the user at +z. The screen is a dark glow panel; the
 * live terminal texture is drawn over it by the laptop layer.
 */
export function laptop(): PieceGeometry {
  const b = new PartBuilder(70);
  const glow = new PartBuilder(71);
  const { w, d, baseH, lidH, lidT, tilt, screenW, screenH } = LAPTOP_DIMENSIONS;
  b.box([w, baseH, d], [0, baseH / 2, 0], LAIR.cream);
  b.box([w - 0.04, 0.004, d * 0.5], [0, baseH + 0.002, -0.02], LAIR.black);
  b.box([w * 0.3, 0.003, d * 0.18], [0, baseH + 0.0015, d * 0.33], LAIR.steel);
  // Hinge barrel, then the lid leaning back by `tilt`.
  b.cylinder(0.014, 0.014, w * 0.9, 8, [0, baseH + 0.006, -d / 2 + 0.01], LAIR.brass, {
    rot: [0, 0, Math.PI / 2],
  });
  const lid = new PartBuilder(72);
  lid.box([w, lidH, lidT], [0, lidH / 2, -lidT / 2], LAIR.steelDark);
  lid.box([w + 0.004, 0.025, lidT + 0.004], [0, lidH - 0.01, -lidT / 2], LAIR.cream);
  const lidGeo = lid.build();
  b.append(lidGeo, [0, baseH, -d / 2 + 0.01], [-tilt, 0, 0]);
  lidGeo.dispose();
  const screen = new PartBuilder(73);
  screen.panelZ(
    -screenW / 2,
    (lidH - screenH) / 2 - 0.005,
    screenW / 2,
    (lidH + screenH) / 2 - 0.005,
    0.002,
    "#123C3A",
  );
  const scrGeo = screen.build();
  glow.append(scrGeo, [0, baseH, -d / 2 + 0.01], [-tilt, 0, 0]);
  scrGeo.dispose();
  return { body: b.build(), glow: glow.build() };
}
