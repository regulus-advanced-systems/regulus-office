/**
 * The blast door's architecture (#188; SPEC §9.4, §12; D23 original): the
 * portal on the mountain face (concrete pillars and a lintel with hazard
 * chevrons, a brass emblem disc and floodlights, rock piled up round it),
 * steel jambs and a striped header inside the lobby, the lobby's wall button
 * and the portal's keypad, and the heavy door leaf. Baked meshes in
 * compound metres (the leaf in its own frame). Pure.
 */
import { CylinderGeometry } from "three";
import { WALL_HEIGHT, WALL_THICKNESS } from "../../lair/dimensions.ts";
import { PartBuilder, type PieceGeometry, type Vec3 } from "../../lair/geometry/builder.ts";
import { LAIR } from "../../lair/palette.ts";
import type { OutsideLayout } from "./layout.ts";

/** The leaf: half the doorway wide, the wall's height, slimmer than the wall (it slides into it). */
export const LEAF = { w: 4, h: WALL_HEIGHT - 0.02, d: 0.26 } as const;
const PORTAL_H = 4.4;
const PILLAR = { w: 0.9, d: 0.95 } as const;
const CONCRETE = LAIR.concrete;

/** One leaf, centred on x with its floor at y = 0; its meeting edge at +x. */
export function leafGeometry(): PieceGeometry {
  const b = new PartBuilder(31);
  const glow = new PartBuilder(32);
  const { w, h, d } = LEAF;
  b.box([w, h, d], [0, h / 2, 0], LAIR.steel, { jitter: 0.05 });
  for (const face of [1, -1]) {
    const z = (face * d) / 2;
    const zo = z + face * 0.035;
    // Ribs, rivet rows and the striped foot, on both faces.
    for (const y of [0.95, 1.75, 2.55]) {
      b.box([w - 0.2, 0.12, 0.06], [0, y, zo], LAIR.steelDark);
      for (let x = -w / 2 + 0.25; x < w / 2 - 0.1; x += 0.35) {
        if (face > 0) b.rivetZ(x, y + 0.11, z + 0.002, LAIR.steelLight, 0.025);
      }
    }
    if (face > 0) b.hazardZ(-w / 2, 0.06, w / 2, 0.55, z + 0.005, 10);
    else {
      // The other face is the same leaf turned round: draw its stripes facing -z.
      const s = new PartBuilder(33);
      s.hazardZ(-w / 2, 0.06, w / 2, 0.55, d / 2 + 0.005, 10);
      b.append(s.build(), [0, 0, 0], [0, Math.PI, 0]);
    }
    // Half of the locking wheel on the meeting edge, and a stencilled number band.
    b.add(
      new CylinderGeometry(0.42, 0.42, 0.08, 12, 1, false, face > 0 ? 0 : Math.PI, Math.PI),
      [w / 2, 1.55, zo],
      LAIR.brass,
      {
        rot: [Math.PI / 2, 0, 0],
      },
    );
    b.box([1.2, 0.3, 0.02], [-0.6, 2.2, zo + face * 0.02], LAIR.yellow);
  }
  b.box([0.08, h, d + 0.04], [w / 2 - 0.04, h / 2, 0], LAIR.black);
  glow.box([0.06, 0.06, d + 0.08], [w / 2 - 0.3, 2.85, 0], LAIR.red);
  return { body: b.build(), glow: glow.build() };
}

/** A pile of boulders against the face between `xa` and `xb`, up to `top` metres. */
function rockPile(b: PartBuilder, xa: number, xb: number, z: number, top: number): void {
  const span = xb - xa;
  const n = Math.max(3, Math.round(span / 1.3));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = xa + span * t;
    const peak = top * (0.55 + 0.45 * Math.sin(t * Math.PI));
    for (let y = 0.7; y < peak; y += 1.3) {
      const r = 0.9 + b.random() * 0.6;
      b.boulder(
        r,
        [x + (b.random() - 0.5) * 0.6, y, z + r * 0.9 + b.random() * 0.4],
        b.random() > 0.5 ? LAIR.rock : LAIR.rockCool,
        {
          scale: [1.1, 0.9, 0.8],
          lump: 0.3,
        },
      );
    }
  }
}

/** A button panel on a wall face, the face toward `face` (+1 south, -1 north). */
function buttonPanel(b: PartBuilder, glow: PartBuilder, x: number, z: number, face: number): void {
  const at = (dx: number, y: number, out: number): Vec3 => [x + dx, y, z + face * out];
  const rot: Vec3 = [0, face > 0 ? 0 : Math.PI, 0];
  b.box([0.56, 0.78, 0.1], at(0, 1.3, 0.05), LAIR.black, { rot });
  b.box([0.48, 0.7, 0.04], at(0, 1.3, 0.11), LAIR.yellow, { rot });
  b.box([0.36, 0.5, 0.03], at(0, 1.3, 0.13), LAIR.steelDark, { rot });
  // The mushroom button and its collar; its cap glows.
  b.cylinder(0.12, 0.12, 0.05, 10, at(0, 1.38, 0.16), LAIR.chrome, { rot: [Math.PI / 2, 0, 0] });
  glow.cylinder(0.09, 0.1, 0.07, 10, at(0, 1.38, 0.2), LAIR.red, { rot: [Math.PI / 2, 0, 0] });
  glow.box([0.22, 0.05, 0.02], at(0, 1.15, 0.15), LAIR.tungstenGlow, { rot });
  b.box([0.06, 1.0, 0.06], at(0.3, 0.6, 0.04), LAIR.steelDark, { rot });
}

/**
 * Portal, jambs, header, rock piles, button panels and floodlights; `cut` is
 * everything that stands like a wall (cut away near the player).
 */
export function portalGeometry(layout: OutsideLayout, opts: { low?: boolean } = {}): PieceGeometry {
  const b = new PartBuilder(9);
  const glow = new PartBuilder(10);
  const { x0, x1, centre } = layout.door;
  const face = layout.edgeZ + WALL_THICKNESS;
  const zc = face + PILLAR.d / 2 - 0.2;
  // Pillars and lintel.
  for (const x of [x0 - PILLAR.w / 2, x1 + PILLAR.w / 2]) {
    b.box([PILLAR.w, PORTAL_H, PILLAR.d], [x, PORTAL_H / 2, zc], CONCRETE, { jitter: 0.08 });
    b.box([PILLAR.w + 0.1, 0.25, PILLAR.d + 0.1], [x, 0.12, zc], LAIR.concreteDark);
    b.box([PILLAR.w + 0.12, 0.2, PILLAR.d + 0.12], [x, PORTAL_H + 0.1, zc], LAIR.concreteDark);
  }
  const lintelW = x1 - x0;
  const lintelH = PORTAL_H - WALL_HEIGHT;
  b.box([lintelW, lintelH, PILLAR.d], [centre, WALL_HEIGHT + lintelH / 2, zc], CONCRETE, {
    jitter: 0.08,
  });
  b.hazardZ(x0, WALL_HEIGHT + 0.05, x1, WALL_HEIGHT + 0.5, zc + PILLAR.d / 2 + 0.005, 16);
  b.cylinder(
    0.5,
    0.5,
    0.08,
    14,
    [centre, WALL_HEIGHT + 0.85, zc + PILLAR.d / 2 + 0.04],
    LAIR.brass,
    {
      rot: [Math.PI / 2, 0, 0],
    },
  );
  b.cylinder(
    0.32,
    0.32,
    0.1,
    3,
    [centre, WALL_HEIGHT + 0.85, zc + PILLAR.d / 2 + 0.06],
    LAIR.black,
    {
      rot: [Math.PI / 2, Math.PI, 0],
    },
  );
  // Hazard stripes down the pillars' inner faces and floodlights on the lintel.
  for (const x of [x0 - PILLAR.w / 2, x1 + PILLAR.w / 2]) {
    b.box([PILLAR.w * 0.7, 2.4, 0.02], [x, 1.5, zc + PILLAR.d / 2 + 0.01], LAIR.yellow);
    for (let y = 0.5; y < 2.6; y += 0.5)
      b.box([PILLAR.w * 0.7, 0.18, 0.025], [x, y, zc + PILLAR.d / 2 + 0.012], LAIR.black, {
        rot: [0, 0, 0.5],
      });
  }
  for (const x of [x0 + 1, x1 - 1]) {
    b.box([0.4, 0.28, 0.3], [x, PORTAL_H + 0.3, zc + 0.2], LAIR.steelDark, { rot: [0.5, 0, 0] });
    glow.box([0.32, 0.2, 0.04], [x, PORTAL_H + 0.24, zc + 0.37], LAIR.tungstenGlow, {
      rot: [0.5, 0, 0],
    });
  }
  // Rock heaped round the portal: the mountain face (lower in the software tier: less to fill).
  rockPile(b, x0 - 6.5, x0 - PILLAR.w, face, opts.low ? 2.4 : 5.2);
  rockPile(b, x1 + PILLAR.w + 1.2, x1 + 6.8, face, opts.low ? 2.4 : 5.4);
  for (let x = x0 - 0.6; !opts.low && x <= x1 + 0.6; x += 1.4) {
    const r = 0.8 + b.random() * 0.5;
    b.boulder(r, [x, PORTAL_H + 0.45, face + 0.75], LAIR.rock, {
      scale: [1.2, 0.7, 0.8],
      lump: 0.3,
    });
  }
  // Inside the lobby: steel jambs and a striped header over the doorway.
  const inner = layout.edgeZ - 0.02;
  for (const x of [x0 - 0.12, x1 + 0.12]) {
    b.box([0.24, WALL_HEIGHT, 0.5], [x, WALL_HEIGHT / 2, layout.edgeZ + 0.1], LAIR.steelDark);
  }
  const header = new PartBuilder(12);
  header.hazardZ(x0, WALL_HEIGHT - 0.3, x1, WALL_HEIGHT - 0.02, 0, 16);
  b.append(header.build(), [centre * 2, 0, inner - 0.06], [0, Math.PI, 0]);
  // The button inside (on the lobby side) and the keypad outside.
  const [inside, outside] = layout.buttons;
  buttonPanel(b, glow, inside.wall.x, layout.edgeZ - 0.02, -1);
  buttonPanel(b, glow, outside.wall.x, face, 1);
  return { body: b.build(), glow: glow.build() };
}
