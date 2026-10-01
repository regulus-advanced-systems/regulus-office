/**
 * Control consoles (#183), the heart of the 1960s lair look: a sloped
 * operator console with CRT screens, an oscilloscope, brass dials and toggle
 * banks, and a tape-reel mainframe cabinet. Operator side toward +z.
 *
 * The blinking lamps are NOT baked in: each piece exports its lamp sockets
 * (`*_LAMPS`) and BlinkingLamps.tsx draws every lamp of every console in
 * the scene as one instanced mesh whose colours it animates.
 */
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry, type Vec3 } from "./builder.ts";

export interface LampSocket {
  /** Lamp centre, piece-local. */
  pos: Vec3;
  /** Lit colour. */
  color: string;
}

const LAMP_COLORS = [LAIR.red, LAIR.yellow, LAIR.teal, "#7CFC5A", LAIR.tungsten] as const;
const lampColor = (i: number) => LAMP_COLORS[(i * 7 + (i >> 2)) % LAMP_COLORS.length] ?? LAIR.red;

export const CONSOLE_SIZE = { w: 1.7, h: 1.55, d: 0.95 } as const;
const SLOPE = 0.38;

/** Where the sloped desk panel's surface is: its centre and tilt about x. */
const DESK = { y: 0.86, z: 0.2, depth: 0.52, tilt: SLOPE } as const;

/** A point on the sloped panel: `u` across (m from centre), `v` up the slope (m from its centre). */
function onDesk(u: number, v: number, lift = 0.035): Vec3 {
  const c = Math.cos(DESK.tilt);
  const s = Math.sin(DESK.tilt);
  return [u, DESK.y + v * s + lift * c, DESK.z - v * c + lift * s];
}

export const CONSOLE_LAMPS: readonly LampSocket[] = (() => {
  const out: LampSocket[] = [];
  // A row along the top of the tower face and two short rows on the desk.
  for (let i = 0; i < 10; i++)
    out.push({ pos: [-0.72 + i * 0.16, 1.47, -0.12], color: lampColor(i) });
  for (let i = 0; i < 6; i++)
    out.push({ pos: onDesk(-0.7 + i * 0.07, 0.17), color: lampColor(i + 10) });
  for (let i = 0; i < 6; i++)
    out.push({ pos: onDesk(0.35 + i * 0.07, 0.17), color: lampColor(i + 16) });
  return out;
})();

export function controlConsole(): PieceGeometry {
  const b = new PartBuilder(41);
  const { w } = CONSOLE_SIZE;
  const glow = new PartBuilder(42);
  // Recessed black plinth, lower body, chrome edge strip.
  b.box([w - 0.08, 0.08, 0.78], [0, 0.04, -0.05], LAIR.black);
  b.box([w, 0.74, 0.82], [0, 0.45, -0.04], LAIR.steelPaint, { jitter: 0.06 });
  b.box([w + 0.02, 0.03, 0.06], [0, 0.82, 0.37], LAIR.chrome);
  // Walnut cheek panels: the retro-futurist touch.
  for (const side of [-1, 1])
    b.box([0.05, 0.86, 0.9], [side * (w / 2 + 0.025), 0.45, -0.02], LAIR.walnut);
  // Sloped desk.
  b.box([w, 0.05, DESK.depth], [0, DESK.y, DESK.z], LAIR.steelDark, { rot: [DESK.tilt, 0, 0] });
  // Tower with a slight backward lean.
  b.box([w, 0.72, 0.32], [0, 1.18, -0.28], LAIR.steelPaint, { rot: [-0.08, 0, 0], jitter: 0.05 });
  b.box([w + 0.04, 0.05, 0.38], [0, 1.555, -0.3], LAIR.steelDark);
  // Two CRT bezels and screens, an oscilloscope between them.
  for (const x of [-0.5, 0.5]) {
    b.box([0.46, 0.34, 0.04], [x, 1.16, -0.1], LAIR.black);
    glow.box([0.38, 0.27, 0.01], [x, 1.16, -0.077], x < 0 ? LAIR.teal : "#2EA88F");
  }
  b.cylinder(0.13, 0.13, 0.04, 14, [0, 1.16, -0.1], LAIR.black, { rot: [Math.PI / 2, 0, 0] });
  glow.cylinder(0.105, 0.105, 0.01, 14, [0, 1.16, -0.077], "#7CFC5A", { rot: [Math.PI / 2, 0, 0] });
  // Lamp sockets (the lamps themselves are instanced and blink).
  for (const l of CONSOLE_LAMPS)
    b.box([0.05, 0.05, 0.02], [l.pos[0], l.pos[1], l.pos[2] - 0.012], LAIR.black, {
      rot: l.pos[1] > 1.3 ? [0, 0, 0] : [DESK.tilt, 0, 0],
    });
  // Brass dials and a chrome toggle bank on the desk.
  for (const u of [-0.25, -0.1, 0.05, 0.2]) {
    b.cylinder(0.04, 0.045, 0.04, 10, onDesk(u, -0.02, 0.045), LAIR.brass, {
      rot: [DESK.tilt, 0, 0],
      smooth: true,
    });
  }
  for (let i = 0; i < 8; i++) {
    b.box([0.015, 0.05, 0.015], onDesk(-0.7 + i * 0.05, -0.12, 0.05), LAIR.chrome, {
      rot: [DESK.tilt - 0.4, 0, 0],
    });
  }
  for (let i = 0; i < 6; i++) {
    b.box(
      [0.04, 0.012, 0.03],
      onDesk(0.35 + i * 0.07, -0.12, 0.03),
      i === 2 ? LAIR.red : LAIR.cream,
      {
        rot: [DESK.tilt, 0, 0],
      },
    );
  }
  // A telephone handset and a coffee mug: somebody works here.
  b.box([0.2, 0.05, 0.08], onDesk(0.62, -0.05, 0.06), LAIR.black, { rot: [DESK.tilt, 0, 0] });
  b.cylinder(0.035, 0.03, 0.08, 8, [-0.78, 0.9, 0.36], LAIR.cream, { smooth: true });
  // Vent slots on the front.
  for (let i = 0; i < 5; i++)
    b.panelZ(-0.6 + i * 0.3, 0.2, -0.45 + i * 0.3, 0.24, 0.371, LAIR.black);
  return { body: b.build(), glow: glow.build() };
}

export const MAINFRAME_SIZE = { w: 1.3, h: 2.1, d: 0.7 } as const;

export const MAINFRAME_LAMPS: readonly LampSocket[] = (() => {
  const out: LampSocket[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 8; c++)
      out.push({ pos: [-0.42 + c * 0.12, 0.92 - r * 0.1, 0.362], color: lampColor(r * 8 + c) });
  }
  return out;
})();

/** A tape-reel computer cabinet: two reels behind glass, a lamp grid, punched vents. */
export function mainframe(): PieceGeometry {
  const b = new PartBuilder(43);
  const glow = new PartBuilder(44);
  const { w, h, d } = MAINFRAME_SIZE;
  b.box([w, h, d], [0, h / 2, 0], LAIR.cream, { jitter: 0.05 });
  b.box([w + 0.04, 0.08, d + 0.04], [0, h + 0.04, 0], LAIR.steelDark);
  b.box([w + 0.04, 0.1, d + 0.04], [0, 0.05, 0], LAIR.black);
  // Reel window: dark glass with two reels, brass hubs.
  b.box([w - 0.2, 0.68, 0.03], [0, 1.55, d / 2 + 0.005], LAIR.steelDark);
  b.panelZ(-(w - 0.28) / 2, 1.25, (w - 0.28) / 2, 1.85, d / 2 + 0.021, "#20343A");
  for (const x of [-0.27, 0.27]) {
    b.cylinder(0.22, 0.22, 0.03, 16, [x, 1.55, d / 2 + 0.04], LAIR.black, {
      rot: [Math.PI / 2, 0, 0],
    });
    b.cylinder(0.15, 0.15, 0.035, 16, [x, 1.55, d / 2 + 0.042], "#3B3226", {
      rot: [Math.PI / 2, 0, 0],
    });
    b.cylinder(0.05, 0.05, 0.05, 8, [x, 1.55, d / 2 + 0.05], LAIR.brass, {
      rot: [Math.PI / 2, 0, 0],
    });
  }
  // Lamp panel and its sockets.
  b.box([w - 0.2, 0.46, 0.02], [0, 0.77, d / 2 + 0.005], LAIR.steelPaint);
  for (const l of MAINFRAME_LAMPS)
    b.panelZ(
      l.pos[0] - 0.03,
      l.pos[1] - 0.03,
      l.pos[0] + 0.03,
      l.pos[1] + 0.03,
      d / 2 + 0.016,
      LAIR.black,
    );
  // Punched vents and a teal status strip.
  for (let i = 0; i < 6; i++)
    b.panelZ(-0.45 + i * 0.16, 0.2, -0.35 + i * 0.16, 0.45, d / 2 + 0.001, LAIR.steelDark);
  glow.box([w - 0.3, 0.025, 0.01], [0, 1.08, d / 2 + 0.01], LAIR.teal);
  return { body: b.build(), glow: glow.build() };
}
