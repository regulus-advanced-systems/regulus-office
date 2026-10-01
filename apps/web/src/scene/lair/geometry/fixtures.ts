/**
 * Wall and ceiling fixtures (#183): caged tungsten wall lamps, hanging
 * industrial pendants (rooms are cutaways with no ceiling, so they hang from
 * a short beam stub), the red alarm beacon, pipe runs with flanges and
 * brackets, a pipe elbow for corners, a cable tray with bundled cables, and
 * a louvred vent. Wall-mounted pieces sit against a wall whose room face is
 * at z = 0 in their local space (offset them by `WALL_THICKNESS / 2`).
 * Bulbs and lenses are the unlit `glow` layer.
 */
import { TorusGeometry } from "three";
import { PIPE_Y, TILE, WALL_HEIGHT, WALL_LAMP_Y } from "../dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

const HALF_PI = Math.PI / 2;

export function wallLamp(): PieceGeometry {
  const b = new PartBuilder(31);
  const y = WALL_LAMP_Y;
  b.box([0.16, 0.24, 0.03], [0, y + 0.02, 0.015], LAIR.steelDark);
  b.cylinder(0.02, 0.02, 0.18, 6, [0, y + 0.08, 0.11], LAIR.steelDark, { rot: [HALF_PI, 0, 0] });
  // Conical shade opening downward, then a wire cage around the bulb.
  b.cylinder(0.05, 0.13, 0.1, 10, [0, y + 0.06, 0.22], LAIR.steelPaint, { smooth: true });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.box(
      [0.012, 0.16, 0.012],
      [Math.cos(a) * 0.09, y - 0.07, 0.22 + Math.sin(a) * 0.09],
      LAIR.black,
    );
  }
  b.cylinder(0.1, 0.1, 0.012, 10, [0, y - 0.15, 0.22], LAIR.black);
  const glow = new PartBuilder(32);
  glow.sphere(0.065, 8, 6, [0, y - 0.04, 0.22], LAIR.tungstenGlow, { smooth: true });
  return { body: b.build(), glow: glow.build() };
}

/**
 * A hanging dome pendant, centred at x = z = 0, its cable rising to the
 * underside of a `ceiling_beam` at the top of the wall line (rooms are
 * cutaways with no ceiling, so lights hang from exposed steel beams).
 */
export function ceilingLight(): PieceGeometry {
  const b = new PartBuilder(33);
  const top = WALL_HEIGHT - BEAM_DEPTH;
  const drop = 0.65;
  b.cylinder(0.04, 0.05, 0.05, 8, [0, top - 0.02, 0], LAIR.steelDark);
  b.box([0.015, drop, 0.015], [0, top - drop / 2, 0], LAIR.black);
  const y = top - drop;
  // Enamelled dome shade: dark outside, cream inside lip.
  b.cylinder(0.08, 0.36, 0.22, 12, [0, y - 0.1, 0], LAIR.steelPaint, { smooth: true });
  b.cylinder(0.36, 0.38, 0.03, 12, [0, y - 0.22, 0], LAIR.cream, { smooth: true });
  b.cylinder(0.05, 0.05, 0.06, 8, [0, y + 0.02, 0], LAIR.brass, { smooth: true });
  const glow = new PartBuilder(34);
  glow.sphere(0.1, 8, 6, [0, y - 0.2, 0], LAIR.tungstenGlow, { smooth: true });
  return { body: b.build(), glow: glow.build() };
}

/** Depth of the exposed steel I-beam; its top is flush with the wall tops. */
export const BEAM_DEPTH = 0.24;

/**
 * An exposed riveted I-beam, ONE metre long along x and centred: scale it in
 * x to span wall to wall (or pillar to pillar), so one piece fits any span.
 * No rivets on the flanges, so it stretches cleanly.
 */
export function ceilingBeam(): PieceGeometry {
  const b = new PartBuilder(30);
  const y = WALL_HEIGHT - BEAM_DEPTH / 2;
  b.box([1, 0.03, 0.2], [0, WALL_HEIGHT - 0.015, 0], LAIR.steelDark);
  b.box([1, 0.03, 0.2], [0, WALL_HEIGHT - BEAM_DEPTH + 0.015, 0], LAIR.steelDark);
  b.box([1, BEAM_DEPTH - 0.06, 0.03], [0, y, 0], LAIR.steel);
  // A thin yellow line down the top flange so the beams read from above.
  b.panelY(-0.5, -0.02, 0.5, 0.02, WALL_HEIGHT + 0.001, LAIR.yellow, 0.8);
  return { body: b.build() };
}

/** Light pools: where a lamp's point light goes, relative to the piece. */
export const LAMP_LIGHT_OFFSET = {
  wall_lamp: [0, WALL_LAMP_Y - 0.2, 0.45],
  ceiling_light: [0, WALL_HEIGHT - 1.15, 0],
} as const;

/** The rotating alarm beacon: a steel base and a red dome; the dome is glow so it reads in the dark. */
export function beacon(): PieceGeometry {
  const b = new PartBuilder(35);
  b.cylinder(0.11, 0.12, 0.06, 10, [0, 0.03, 0], LAIR.steelDark, { smooth: true });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    b.box([0.012, 0.16, 0.012], [Math.cos(a) * 0.1, 0.13, Math.sin(a) * 0.1], LAIR.steelDark);
  }
  const glow = new PartBuilder(36);
  glow.cylinder(0.085, 0.095, 0.14, 10, [0, 0.13, 0], LAIR.red, { smooth: true });
  glow.sphere(0.085, 10, 5, [0, 0.2, 0], LAIR.red, { smooth: true });
  return { body: b.build(), glow: glow.build() };
}

/** Two pipes along a 2 m wall run (x), a steam pipe and a painted water main, on brackets. */
export function pipeRun(): PieceGeometry {
  const b = new PartBuilder(37);
  const L = TILE;
  const pipes = [
    { r: 0.075, y: PIPE_Y, z: 0.14, color: LAIR.steel },
    { r: 0.05, y: PIPE_Y - 0.22, z: 0.12, color: LAIR.red },
  ];
  for (const p of pipes) {
    b.cylinder(p.r, p.r, L, 10, [0, p.y, p.z], p.color, { rot: [0, 0, HALF_PI], smooth: true });
    // A flange at one end (where the next run bolts on) and one mid-run.
    for (const x of [-L / 2 + 0.04, 0.3]) {
      b.cylinder(p.r * 1.45, p.r * 1.45, 0.05, 10, [x, p.y, p.z], LAIR.steelDark, {
        rot: [0, 0, HALF_PI],
      });
    }
  }
  // Brackets back to the wall.
  for (const x of [-0.55, 0.55]) {
    b.box([0.05, 0.42, 0.04], [x, PIPE_Y - 0.1, 0.02], LAIR.steelDark);
    b.box([0.05, 0.03, 0.22], [x, PIPE_Y - 0.08, 0.11], LAIR.steelDark);
    b.box([0.05, 0.03, 0.2], [x, PIPE_Y - 0.3, 0.1], LAIR.steelDark);
  }
  // A valve wheel on the red main.
  b.cylinder(0.02, 0.02, 0.1, 6, [-0.25, PIPE_Y - 0.22, 0.2], LAIR.brass, { rot: [HALF_PI, 0, 0] });
  b.add(torus(0.07, 0.012), [-0.25, PIPE_Y - 0.22, 0.25], LAIR.yellow, { smooth: true });
  return { body: b.build() };
}

function torus(r: number, tube: number): TorusGeometry {
  return new TorusGeometry(r, tube, 4, 12);
}

/** A 90° turn for both pipes at an inside corner (walls along -x and -z meet at the origin). */
export function pipeElbow(): PieceGeometry {
  const b = new PartBuilder(38);
  for (const p of [
    { r: 0.075, y: PIPE_Y, off: 0.14, color: LAIR.steel },
    { r: 0.05, y: PIPE_Y - 0.22, off: 0.12, color: LAIR.red },
  ]) {
    const len = 0.6;
    b.cylinder(p.r, p.r, len, 10, [p.off + len / 2, p.y, p.off], p.color, {
      rot: [0, 0, HALF_PI],
      smooth: true,
    });
    b.cylinder(p.r, p.r, len, 10, [p.off, p.y, p.off + len / 2], p.color, {
      rot: [HALF_PI, 0, 0],
      smooth: true,
    });
    b.sphere(p.r * 1.25, 10, 6, [p.off, p.y, p.off], LAIR.steelDark, { smooth: true });
  }
  return { body: b.build() };
}

/** A ladder-style cable tray along a 2 m wall run with three bundled cables (power, signal, alarm). */
export function cableTray(): PieceGeometry {
  const b = new PartBuilder(39);
  const L = TILE;
  const y = PIPE_Y + 0.22;
  b.box([L, 0.02, 0.2], [0, y, 0.12], LAIR.steelLight);
  b.box([L, 0.06, 0.015], [0, y + 0.03, 0.22], LAIR.steelLight);
  for (const x of [-0.6, 0.6]) b.box([0.04, 0.04, 0.22], [x, y - 0.03, 0.11], LAIR.steelDark);
  const cables = [
    { z: 0.07, r: 0.028, color: LAIR.black },
    { z: 0.13, r: 0.022, color: LAIR.yellow },
    { z: 0.18, r: 0.02, color: LAIR.red },
  ];
  for (const c of cables) {
    b.cylinder(c.r, c.r, L, 6, [0, y + 0.01 + c.r, c.z], c.color, {
      rot: [0, 0, HALF_PI],
      smooth: true,
    });
  }
  // A slack loop drooping out of the tray: someone's patch job.
  b.cylinder(0.015, 0.015, 0.5, 5, [0.55, y - 0.18, 0.2], LAIR.black, {
    rot: [0, 0, 0.5],
    smooth: true,
  });
  return { body: b.build() };
}

/** A louvred wall vent with a riveted frame and dark ducting behind. */
export function vent(): PieceGeometry {
  const b = new PartBuilder(40);
  const w = 0.9;
  const h = 0.55;
  const cy = 1.9;
  b.box([w + 0.1, h + 0.1, 0.06], [0, cy, 0.03], LAIR.steelDark);
  b.panelZ(-w / 2, cy - h / 2, w / 2, cy + h / 2, 0.061, LAIR.black);
  const n = 6;
  for (let k = 0; k < n; k++) {
    const y = cy - h / 2 + ((k + 0.5) * h) / n;
    b.box([w - 0.02, 0.025, 0.07], [0, y, 0.08], LAIR.steel, { rot: [0.6, 0, 0] });
  }
  for (const [x, y] of [
    [-w / 2 - 0.02, cy - h / 2 - 0.02],
    [w / 2 + 0.02, cy - h / 2 - 0.02],
    [-w / 2 - 0.02, cy + h / 2 + 0.02],
    [w / 2 + 0.02, cy + h / 2 + 0.02],
  ] as const) {
    b.rivetZ(x, y, 0.06, LAIR.steelLight, 0.02);
  }
  return { body: b.build() };
}
