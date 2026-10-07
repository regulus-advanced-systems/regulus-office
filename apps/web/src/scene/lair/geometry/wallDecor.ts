/**
 * Wall decor and wall-anchor dressings for the generated rooms (#182 model
 * ids, #183 art): a brass wall clock, a pinboard, five posters (a lair
 * propaganda sheet and the four styles' world map, element chart,
 * blueprint and campaign map), a wall shelf, a whiteboard, the usage panel
 * and a picture frame. All original designs.
 *
 * Wall pieces are centred on their anchor point: x across, y up, the wall
 * at z = 0 and the face toward +z, at a nominal size the placement scales
 * to the anchor's `w` x `h`.
 */
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry, type Vec3 } from "./builder.ts";

function frame(b: PartBuilder, w: number, h: number, depth: number, color: string, border = 0.04) {
  b.box([w, border, depth], [0, h / 2 - border / 2, depth / 2], color);
  b.box([w, border, depth], [0, -h / 2 + border / 2, depth / 2], color);
  b.box([border, h - 2 * border, depth], [-w / 2 + border / 2, 0, depth / 2], color);
  b.box([border, h - 2 * border, depth], [w / 2 - border / 2, 0, depth / 2], color);
}

/** A flat fan (irregular blob) facing +z, for continents and islands. */
function blob(b: PartBuilder, cx: number, cy: number, r: number, z: number, color: string, n = 7) {
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    const r0 = r * (0.75 + 0.3 * Math.sin(k * 2.3 + cx * 9));
    const r1 = r * (0.75 + 0.3 * Math.sin((k + 1) * 2.3 + cx * 9));
    const p0: Vec3 = [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, z];
    const p1: Vec3 = [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, z];
    b.tri([cx, cy, z], p0, p1, color);
  }
}

export function wallClock(): PieceGeometry {
  const b = new PartBuilder(201);
  const r = 0.2;
  b.cylinder(r, r, 0.05, 20, [0, 0, 0.025], LAIR.brass, { rot: [Math.PI / 2, 0, 0], smooth: true });
  b.cylinder(r - 0.025, r - 0.025, 0.01, 20, [0, 0, 0.051], LAIR.cream, {
    rot: [Math.PI / 2, 0, 0],
  });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const len = k % 3 === 0 ? 0.035 : 0.018;
    const rr = r - 0.045;
    b.box([0.008, len, 0.004], [Math.sin(a) * rr, Math.cos(a) * rr, 0.058], LAIR.black, {
      rot: [0, 0, -a],
    });
  }
  // Ten past ten, and a red seconds hand.
  b.box([0.012, 0.1, 0.004], [-0.04, 0.03, 0.062], LAIR.black, { rot: [0, 0, 0.95] });
  b.box([0.01, 0.14, 0.004], [0.045, 0.045, 0.064], LAIR.black, { rot: [0, 0, -0.8] });
  b.box([0.004, 0.15, 0.004], [0, -0.06, 0.066], LAIR.red, { rot: [0, 0, 0.3] });
  return { body: b.build() };
}

export function pinboard(): PieceGeometry {
  const b = new PartBuilder(202);
  const w = 1;
  const h = 0.7;
  b.box([w, h, 0.02], [0, 0, 0.01], "#A87E4E", { jitter: 0.15 });
  frame(b, w, h, 0.035, LAIR.steelDark);
  const notes: [number, number, number, number, string][] = [
    [-0.3, 0.12, 0.22, 0.28, LAIR.cream],
    [0.0, 0.15, 0.2, 0.16, LAIR.yellow],
    [0.3, 0.08, 0.2, 0.26, LAIR.cream],
    [-0.25, -0.18, 0.26, 0.16, "#BFE3DF"],
    [0.12, -0.16, 0.18, 0.22, LAIR.cream],
  ];
  for (const [x, y, nw, nh, c] of notes) {
    b.panelZ(x - nw / 2, y - nh / 2, x + nw / 2, y + nh / 2, 0.022, c);
    b.sphere(0.012, 5, 3, [x, y + nh / 2 - 0.02, 0.026], LAIR.red);
  }
  // A string between two pins: someone is investigating.
  b.box([0.5, 0.004, 0.003], [-0.02, 0.0, 0.03], LAIR.red, { rot: [0, 0, -0.25] });
  return { body: b.build() };
}

export type PosterVariant =
  | "propaganda"
  | "world_map"
  | "element_chart"
  | "blueprint"
  | "campaign_map"
  | "target";

/** A 0.7 x 1.0 m framed poster; `variant` picks the design. */
export function poster(variant: PosterVariant): PieceGeometry {
  const b = new PartBuilder(203);
  const w = 0.7;
  const h = 1;
  const z = 0.016;
  frame(b, w, h, 0.02, LAIR.black, 0.03);
  const x0 = -w / 2 + 0.03;
  const x1 = w / 2 - 0.03;
  const y0 = -h / 2 + 0.03;
  const y1 = h / 2 - 0.03;
  switch (variant) {
    case "propaganda": {
      b.panelZ(x0, y0, x1, y1, z, LAIR.red);
      b.panelZ(x0, y0, x1, y0 + 0.18, z + 0.001, LAIR.black);
      // A yellow lightning bolt over a black ring: the lair's (original) emblem.
      b.cylinder(0.2, 0.2, 0.002, 16, [0, 0.12, z + 0.001], LAIR.black, {
        rot: [Math.PI / 2, 0, 0],
      });
      b.tri(
        [-0.06, 0.32, z + 0.003],
        [0.02, 0.12, z + 0.003],
        [0.08, 0.32, z + 0.003],
        LAIR.yellow,
      );
      b.tri(
        [-0.08, -0.08, z + 0.003],
        [0.06, 0.16, z + 0.003],
        [-0.02, 0.12, z + 0.003],
        LAIR.yellow,
      );
      b.panelZ(x0 + 0.06, y0 + 0.06, x1 - 0.06, y0 + 0.11, z + 0.002, LAIR.yellow);
      break;
    }
    case "world_map": {
      b.panelZ(x0, y0, x1, y1, z, "#2C6E7A");
      for (const [cx, cy, r] of [
        [-0.15, 0.22, 0.12],
        [0.12, 0.1, 0.14],
        [-0.08, -0.15, 0.1],
        [0.18, -0.25, 0.07],
      ] as const) {
        blob(b, cx, cy, r, z + 0.001, LAIR.canvas);
      }
      for (let i = 1; i < 4; i++)
        b.panelZ(
          x0,
          y0 + (i * (y1 - y0)) / 4,
          x1,
          y0 + (i * (y1 - y0)) / 4 + 0.004,
          z + 0.002,
          LAIR.teal,
        );
      b.sphere(0.018, 6, 4, [0.12, 0.1, z + 0.01], LAIR.red);
      break;
    }
    case "element_chart": {
      b.panelZ(x0, y0, x1, y1, z, LAIR.cream);
      const colors = [LAIR.teal, LAIR.yellow, "#E8A0A0", "#A8C8E8", LAIR.leafLight];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 6; c++) {
          if (r < 2 && c > 0 && c < 5) continue;
          const cx = x0 + 0.06 + c * 0.1;
          const cy = y1 - 0.12 - r * 0.11;
          b.panelZ(
            cx - 0.04,
            cy - 0.045,
            cx + 0.04,
            cy + 0.045,
            z + 0.001,
            colors[(r + c * 2) % colors.length] ?? LAIR.teal,
          );
        }
      }
      break;
    }
    case "blueprint": {
      b.panelZ(x0, y0, x1, y1, z, "#1F4E8C");
      const line = (ax: number, ay: number, bx: number, by: number) => {
        const len = Math.hypot(bx - ax, by - ay);
        b.box([len, 0.006, 0.002], [(ax + bx) / 2, (ay + by) / 2, z + 0.002], "#DCE8F5", {
          rot: [0, 0, Math.atan2(by - ay, bx - ax)],
        });
      };
      line(-0.22, -0.3, 0.22, -0.3);
      line(-0.22, -0.3, -0.22, 0.2);
      line(0.22, -0.3, 0.22, 0.2);
      line(-0.22, 0.2, 0, 0.36);
      line(0, 0.36, 0.22, 0.2);
      line(-0.1, -0.3, -0.1, -0.1);
      line(0.05, -0.05, 0.15, -0.05);
      b.cylinder(0.06, 0.06, 0.002, 12, [0.1, 0.12, z + 0.001], "#DCE8F5", {
        rot: [Math.PI / 2, 0, 0],
      });
      b.cylinder(0.05, 0.05, 0.002, 12, [0.1, 0.12, z + 0.002], "#1F4E8C", {
        rot: [Math.PI / 2, 0, 0],
      });
      break;
    }
    case "campaign_map": {
      b.panelZ(x0, y0, x1, y1, z, "#D8C49A");
      blob(b, -0.05, 0.05, 0.22, z + 0.001, "#7E9A5A", 9);
      // Red advance arrows and a black objective cross.
      for (const [ax, ay, rot] of [
        [-0.2, -0.3, 0.6],
        [0.2, -0.25, 2.2],
      ] as const) {
        b.box(
          [0.2, 0.025, 0.002],
          [ax + Math.cos(rot) * 0.1, ay + Math.sin(rot) * 0.1, z + 0.003],
          LAIR.red,
          { rot: [0, 0, rot] },
        );
        const tx = ax + Math.cos(rot) * 0.22;
        const ty = ay + Math.sin(rot) * 0.22;
        b.tri(
          [tx + Math.cos(rot) * 0.05, ty + Math.sin(rot) * 0.05, z + 0.003],
          [tx + Math.cos(rot + 2.3) * 0.04, ty + Math.sin(rot + 2.3) * 0.04, z + 0.003],
          [tx + Math.cos(rot - 2.3) * 0.04, ty + Math.sin(rot - 2.3) * 0.04, z + 0.003],
          LAIR.red,
        );
      }
      b.box([0.08, 0.015, 0.002], [0, 0.08, z + 0.004], LAIR.black, { rot: [0, 0, 0.78] });
      b.box([0.08, 0.015, 0.002], [0, 0.08, z + 0.004], LAIR.black, { rot: [0, 0, -0.78] });
      break;
    }
    case "target": {
      // The armory's range sheet (#282): rings on buff paper, a tight group low and left.
      b.panelZ(x0, y0, x1, y1, z, "#D8C49A");
      const rings = [
        [0.28, LAIR.black],
        [0.19, "#D8C49A"],
        [0.1, "#F28C28"],
      ] as const;
      rings.forEach(([r, c], i) => {
        b.cylinder(r, r, 0.001, 12, [0, 0.08, z + 0.001 + i * 0.001], c, {
          rot: [Math.PI / 2, 0, 0],
        });
      });
      for (const [hx, hy] of [
        [-0.07, 0.02],
        [-0.03, -0.03],
        [-0.1, -0.05],
      ] as const)
        b.panelZ(hx - 0.012, hy - 0.012, hx + 0.012, hy + 0.012, z + 0.005, LAIR.black);
      b.panelZ(x0 + 0.08, y0 + 0.05, x1 - 0.08, y0 + 0.09, z + 0.001, LAIR.black);
      break;
    }
  }
  return { body: b.build() };
}

/** A 1.0 m plank shelf on steel brackets with jars, books and a tin. */
export function wallShelf(): PieceGeometry {
  const b = new PartBuilder(204);
  b.box([1, 0.03, 0.22], [0, -0.1, 0.11], LAIR.walnut);
  for (const x of [-0.35, 0.35]) b.box([0.03, 0.14, 0.2], [x, -0.18, 0.1], LAIR.steelDark);
  const items: [number, number, number, string][] = [
    [-0.38, 0.07, 0.16, LAIR.teal],
    [-0.28, 0.06, 0.12, LAIR.yellow],
  ];
  for (const [x, r, h, c] of items)
    b.cylinder(r * 0.6, r * 0.6, h, 8, [x, -0.085 + h / 2, 0.11], c, { smooth: true });
  for (let i = 0; i < 5; i++)
    b.box(
      [0.04, 0.2 + (i % 2) * 0.03, 0.15],
      [-0.05 + i * 0.045, 0.015 + (i % 2) * 0.015, 0.1],
      [LAIR.red, LAIR.cream, LAIR.olive, LAIR.black, LAIR.teal][i] ?? LAIR.red,
    );
  b.cylinder(0.06, 0.06, 0.1, 10, [0.32, -0.035, 0.11], LAIR.red, { smooth: true });
  return { body: b.build() };
}

/** A 1.6 x 1.0 m whiteboard in a steel frame, with scribbles and a marker tray. */
export function whiteboard(): PieceGeometry {
  const b = new PartBuilder(205);
  const w = 1.6;
  const h = 1;
  b.panelZ(-w / 2, -h / 2, w / 2, h / 2, 0.012, "#EEF0EE");
  frame(b, w, h, 0.03, LAIR.steelLight, 0.035);
  for (const [x, y, len, rot, c] of [
    [-0.4, 0.2, 0.5, 0.1, LAIR.teal],
    [-0.35, 0.05, 0.4, -0.05, LAIR.teal],
    [0.3, 0.15, 0.35, 0.6, LAIR.red],
    [0.25, -0.1, 0.45, 0, LAIR.black],
  ] as const) {
    b.box([len, 0.012, 0.002], [x, y, 0.014], c, { rot: [0, 0, rot] });
  }
  b.box([0.6, 0.03, 0.06], [0, -h / 2 - 0.015, 0.03], LAIR.steelDark);
  b.box([0.12, 0.018, 0.018], [-0.1, -h / 2 + 0.006, 0.04], LAIR.red);
  return { body: b.build() };
}

/** The usage panel: a brass-framed dark instrument panel with bar meters (glow). */
export function usagePanel(): PieceGeometry {
  const b = new PartBuilder(206);
  const glow = new PartBuilder(207);
  const w = 1.4;
  const h = 0.9;
  b.box([w, h, 0.05], [0, 0, 0.025], LAIR.steelDark);
  frame(b, w + 0.04, h + 0.04, 0.06, LAIR.brass, 0.04);
  const bars = [0.8, 0.55, 0.35, 0.65, 0.9, 0.25];
  bars.forEach((v, i) => {
    const x = -w / 2 + 0.18 + i * 0.2;
    b.panelZ(x - 0.05, -0.3, x + 0.05, 0.3, 0.051, LAIR.black);
    const top = -0.3 + 0.6 * v;
    glow.panelZ(
      x - 0.04,
      -0.29,
      x + 0.04,
      top,
      0.053,
      v > 0.8 ? LAIR.red : v > 0.6 ? LAIR.yellow : LAIR.teal,
    );
  });
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05])
    for (const y of [-h / 2 + 0.05, h / 2 - 0.05]) b.rivetZ(x, y, 0.05, LAIR.steelLight);
  return { body: b.build(), glow: glow.build() };
}

/** A walnut-framed oil painting of a volcano island at dusk: the boss's view. */
export function pictureFrame(): PieceGeometry {
  const b = new PartBuilder(208);
  const w = 0.6;
  const h = 0.5;
  frame(b, w, h, 0.04, LAIR.walnut, 0.05);
  b.panelZ(-w / 2, -h / 2, w / 2, h / 2, 0.005, LAIR.walnutDark);
  b.panelZ(-0.25, -0.03, 0.25, 0.2, 0.012, "#E89A5A");
  b.panelZ(-0.25, -0.2, 0.25, -0.03, 0.012, "#2C5E7A");
  b.tri([-0.18, -0.03, 0.014], [0.16, -0.03, 0.014], [0.0, 0.14, 0.014], "#3B2A2A");
  b.panelZ(-0.03, 0.12, 0.03, 0.15, 0.015, LAIR.red);
  return { body: b.build() };
}
