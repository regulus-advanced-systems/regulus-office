/**
 * Lair amenities (#183): filing cabinet, steel shelving, the break-room
 * counter, a rounded 1960s fridge, an espresso machine, a water cooler,
 * tulip and oval tables, the lair jukebox and an arc floor lamp. They stand
 * in for the room-layout obstacle kinds the room generator places. Fronts
 * toward +z; bulbs and dials are the unlit glow layer.
 */
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

/** Four-drawer filing cabinet, 0.5 x 1.3 x 0.6 m, olive steel. */
export function filingCabinet(): PieceGeometry {
  const b = new PartBuilder(91);
  b.box([0.5, 1.3, 0.6], [0, 0.65, 0], LAIR.olive, { jitter: 0.06 });
  for (let k = 0; k < 4; k++) {
    const y = 0.17 + k * 0.31;
    b.box([0.44, 0.27, 0.015], [0, y, 0.305], LAIR.olive, { jitter: 0.1 });
    b.box([0.14, 0.025, 0.03], [0, y + 0.06, 0.32], LAIR.chrome);
    b.panelZ(-0.05, y + 0.09, 0.05, y + 0.12, 0.3135, LAIR.cream);
  }
  // A stack of files and a desk fan on top.
  b.box([0.3, 0.08, 0.22], [-0.05, 1.34, 0], LAIR.cream, { rot: [0, 0.15, 0] });
  b.box([0.28, 0.03, 0.2], [-0.04, 1.395, 0.01], LAIR.yellow, { rot: [0, -0.1, 0] });
  b.cylinder(0.06, 0.08, 0.03, 8, [0.15, 1.315, 0.1], LAIR.steelDark);
  b.cylinder(0.12, 0.12, 0.05, 10, [0.15, 1.48, 0.12], LAIR.steelLight, {
    rot: [Math.PI / 2, 0, 0],
  });
  b.cylinder(0.012, 0.012, 0.12, 5, [0.15, 1.38, 0.1], LAIR.steelDark);
  return { body: b.build() };
}

/** Steel shelving, 1.2 x 1.8 x 0.45 m, with binders, boxes and a spare reel. */
export function shelving(): PieceGeometry {
  const b = new PartBuilder(92);
  const w = 1.2;
  const d = 0.45;
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      b.box([0.04, 1.8, 0.04], [x * (w / 2 - 0.02), 0.9, z * (d / 2 - 0.02)], LAIR.steelDark);
  const binders = [LAIR.red, LAIR.cream, LAIR.teal, LAIR.yellow, LAIR.black, LAIR.olive];
  for (let s = 0; s < 4; s++) {
    const y = 0.12 + s * 0.52;
    b.box([w, 0.03, d], [0, y, 0], LAIR.steel);
    if (s === 3) break;
    let x = -w / 2 + 0.06;
    let i = s * 3;
    while (x < w / 2 - 0.25) {
      const thick = 0.06 + b.random() * 0.04;
      const tall = 0.3 + b.random() * 0.08;
      b.box(
        [thick, tall, 0.28],
        [x + thick / 2, y + 0.015 + tall / 2, 0.02],
        binders[i % binders.length] ?? LAIR.red,
        {
          rot: [0, 0, b.random() < 0.15 ? 0.25 : 0],
        },
      );
      x += thick + 0.005;
      i++;
    }
    b.box([0.22, 0.2, 0.3], [w / 2 - 0.14, y + 0.115, 0], LAIR.crate);
  }
  b.cylinder(0.18, 0.18, 0.04, 14, [-0.2, 1.8 + 0.02, 0], LAIR.black);
  return { body: b.build() };
}

/** Break-room counter, 1.8 x 0.9 x 0.6 m: steel cupboards, a walnut top, a sink. */
export function counter(): PieceGeometry {
  const b = new PartBuilder(93);
  const w = 1.8;
  const d = 0.6;
  b.box([w, 0.86, d], [0, 0.43, 0], LAIR.steelPaint, { jitter: 0.05 });
  b.box([w + 0.04, 0.04, d + 0.03], [0, 0.88, 0.01], LAIR.walnut);
  b.box([w - 0.04, 0.08, 0.02], [0, 0.04, d / 2 + 0.005], LAIR.black);
  for (let i = 0; i < 3; i++) {
    const x = -w / 3 + (i * w) / 3;
    b.box([w / 3 - 0.04, 0.66, 0.012], [x, 0.46, d / 2 + 0.006], LAIR.steel, { jitter: 0.08 });
    b.box([0.02, 0.14, 0.03], [x + w / 6 - 0.08, 0.62, d / 2 + 0.02], LAIR.chrome);
  }
  b.box([0.45, 0.02, 0.35], [0.45, 0.905, 0.02], LAIR.steelDark);
  b.cylinder(0.015, 0.015, 0.25, 6, [0.45, 1.0, -0.2], LAIR.chrome);
  b.box([0.02, 0.02, 0.15], [0.45, 1.12, -0.13], LAIR.chrome);
  // Mugs and a biscuit tin.
  for (const [x, c] of [
    [-0.4, LAIR.orange],
    [-0.3, LAIR.cream],
    [-0.2, LAIR.teal],
  ] as const) {
    b.cylinder(0.035, 0.03, 0.09, 8, [x, 0.945, 0.1], c, { smooth: true });
  }
  b.cylinder(0.1, 0.1, 0.1, 10, [-0.65, 0.95, -0.05], LAIR.red, { smooth: true });
  return { body: b.build() };
}

/** A rounded 1960s fridge, 0.7 x 1.7 x 0.65 m, cream enamel with a chrome handle. */
export function fridge(): PieceGeometry {
  const b = new PartBuilder(94);
  b.box([0.7, 1.5, 0.65], [0, 0.85, 0], LAIR.cream, { jitter: 0.04 });
  b.cylinder(0.35, 0.35, 0.65, 12, [0, 1.6, 0], LAIR.cream, {
    rot: [Math.PI / 2, 0, 0],
    scale: [1, 1, 0.42],
    smooth: true,
  });
  b.box([0.66, 0.1, 0.6], [0, 0.05, 0], LAIR.black);
  b.panelZ(-0.33, 1.15, 0.33, 1.165, 0.326, LAIR.steelLight);
  b.box([0.04, 0.32, 0.05], [0.25, 1.3, 0.35], LAIR.chrome);
  b.box([0.04, 0.2, 0.05], [0.25, 0.85, 0.35], LAIR.chrome);
  // A magnet or two and a note.
  b.panelZ(-0.2, 1.3, -0.05, 1.48, 0.326, "#FFF4C2");
  b.panelZ(-0.14, 1.45, -0.11, 1.48, 0.327, LAIR.red);
  return { body: b.build() };
}

/** A chrome lever espresso machine with a brass eagle-ish dome, 0.4 m tall. */
export function espressoMachine(): PieceGeometry {
  const b = new PartBuilder(95);
  const glow = new PartBuilder(96);
  b.box([0.42, 0.28, 0.32], [0, 0.14, 0], LAIR.chrome);
  b.cylinder(0.1, 0.13, 0.1, 10, [0, 0.33, -0.03], LAIR.brass, { smooth: true });
  b.sphere(0.05, 8, 5, [0, 0.4, -0.03], LAIR.brass, { smooth: true });
  for (const x of [-0.1, 0.1]) {
    b.cylinder(0.025, 0.025, 0.08, 6, [x, 0.19, 0.18], LAIR.black);
    b.box([0.02, 0.18, 0.02], [x, 0.29, 0.2], LAIR.black, { rot: [0.4, 0, 0] });
    b.cylinder(0.03, 0.025, 0.05, 8, [x, 0.04, 0.16], LAIR.cream, { smooth: true });
  }
  glow.cylinder(0.02, 0.02, 0.01, 8, [0.16, 0.22, 0.161], LAIR.red, { rot: [Math.PI / 2, 0, 0] });
  return { body: b.build(), glow: glow.build() };
}

/** Water cooler, 1.2 m: a steel cabinet with a blue bottle on top. */
export function waterCooler(): PieceGeometry {
  const b = new PartBuilder(97);
  b.box([0.34, 0.85, 0.34], [0, 0.425, 0], LAIR.steelLight, { jitter: 0.05 });
  b.box([0.2, 0.08, 0.04], [0, 0.72, 0.18], LAIR.black);
  b.cylinder(0.14, 0.14, 0.32, 10, [0, 1.02, 0], "#5DA9C9", { smooth: true });
  b.cylinder(0.06, 0.14, 0.06, 10, [0, 0.89, 0], "#5DA9C9", { smooth: true });
  b.cylinder(0.1, 0.12, 0.02, 10, [0, 1.19, 0], "#5DA9C9", { smooth: true });
  b.box([0.04, 0.12, 0.03], [0.24, 0.55, 0], LAIR.cream);
  return { body: b.build() };
}

/** A tulip pedestal table, 0.8 m round. */
export function tulipTable(): PieceGeometry {
  const b = new PartBuilder(98);
  b.cylinder(0.25, 0.3, 0.03, 14, [0, 0.015, 0], LAIR.cream, { smooth: true });
  b.cylinder(0.04, 0.12, 0.7, 10, [0, 0.38, 0], LAIR.cream, { smooth: true });
  b.cylinder(0.4, 0.4, 0.04, 16, [0, 0.74, 0], LAIR.walnut, { smooth: true });
  b.cylinder(0.04, 0.035, 0.09, 8, [0.12, 0.805, 0.05], LAIR.cream, { smooth: true });
  return { body: b.build() };
}

/** A low oval coffee table, 1.1 x 0.6 m, walnut on chrome, with a magazine and an ashtray. */
export function ovalCoffeeTable(): PieceGeometry {
  const b = new PartBuilder(99);
  b.cylinder(0.55, 0.55, 0.05, 16, [0, 0.4, 0], LAIR.walnut, { scale: [1, 1, 0.55], smooth: true });
  // A chrome pedestal on a flat oval foot.
  b.cylinder(0.05, 0.07, 0.38, 8, [0, 0.19, 0], LAIR.chrome, { smooth: true });
  b.cylinder(0.3, 0.3, 0.025, 12, [0, 0.0125, 0], LAIR.chrome, {
    scale: [1, 1, 0.6],
    smooth: true,
  });
  b.box([0.22, 0.01, 0.28], [-0.15, 0.43, 0.02], LAIR.red, { rot: [0, 0.4, 0] });
  b.cylinder(0.06, 0.05, 0.03, 10, [0.25, 0.44, -0.05], LAIR.brass);
  return { body: b.build() };
}

/** The lair jukebox, 0.9 x 1.6 m: a walnut arch, chrome grille, lit coloured tubes. */
export function jukebox(): PieceGeometry {
  const b = new PartBuilder(100);
  const glow = new PartBuilder(101);
  const w = 0.9;
  b.box([w, 1.1, 0.6], [0, 0.55, 0], LAIR.walnut);
  b.cylinder(w / 2, w / 2, 0.6, 14, [0, 1.1, 0], LAIR.walnut, { rot: [Math.PI / 2, 0, 0] });
  b.box([w - 0.2, 0.42, 0.02], [0, 0.42, 0.305], LAIR.chrome);
  for (let i = 0; i < 6; i++)
    b.panelZ(-0.3, 0.25 + i * 0.065, 0.3, 0.27 + i * 0.065, 0.317, LAIR.steelDark);
  b.box([w - 0.3, 0.28, 0.02], [0, 0.92, 0.305], "#20343A");
  // Coloured tubes up the sides and round the arch, unlit so they glow.
  for (const side of [-1, 1])
    glow.box(
      [0.05, 0.9, 0.03],
      [side * (w / 2 - 0.06), 0.65, 0.31],
      side < 0 ? LAIR.tungsten : LAIR.teal,
    );
  glow.cylinder(w / 2 - 0.04, w / 2 - 0.04, 0.02, 14, [0, 1.1, 0.305], LAIR.red, {
    rot: [Math.PI / 2, 0, 0],
    scale: [1, 1, 1],
  });
  b.cylinder(w / 2 - 0.1, w / 2 - 0.1, 0.03, 14, [0, 1.1, 0.31], LAIR.walnutDark, {
    rot: [Math.PI / 2, 0, 0],
  });
  glow.box([w - 0.36, 0.2, 0.01], [0, 0.92, 0.316], LAIR.tungstenGlow);
  return { body: b.build(), glow: glow.build() };
}

/** An arc floor lamp: a marble foot, a chrome arc and a brass dome over a warm bulb, 1.8 m. */
export function arcLamp(): PieceGeometry {
  const b = new PartBuilder(102);
  const glow = new PartBuilder(103);
  b.box([0.34, 0.12, 0.24], [0, 0.06, 0], LAIR.cream, { jitter: 0.1 });
  // A straight pole, then an arc over to the shade (centre c, radius r, from pi down to 0.15 rad).
  const c = [0.45, 1.35] as const;
  const r = 0.45;
  b.cylinder(0.022, 0.022, c[1] - 0.12, 6, [0, (c[1] + 0.12) / 2, 0], LAIR.chrome, {
    smooth: true,
  });
  const segs = 7;
  const a0 = Math.PI;
  const a1 = 0.15;
  const point = (a: number) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as const;
  for (let i = 0; i < segs; i++) {
    const p0 = point(a0 + ((a1 - a0) * i) / segs);
    const p1 = point(a0 + ((a1 - a0) * (i + 1)) / segs);
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const tilt = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    b.cylinder(
      0.018,
      0.018,
      len + 0.01,
      6,
      [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0],
      LAIR.chrome,
      {
        rot: [0, 0, -tilt],
        smooth: true,
      },
    );
  }
  const end = point(a1);
  b.cylinder(0.06, 0.2, 0.16, 12, [end[0], end[1] - 0.1, 0], LAIR.brass, { smooth: true });
  glow.sphere(0.07, 8, 5, [end[0], end[1] - 0.2, 0], LAIR.tungstenGlow, { smooth: true });
  return { body: b.build(), glow: glow.build() };
}
