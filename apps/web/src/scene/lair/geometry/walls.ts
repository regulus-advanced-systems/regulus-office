/**
 * Wall segments for rooms and corridors (#183): one tile (2 m) long, 3 m
 * tall, room side toward +z. Three finishes share one frame so they mix
 * along a wall: rough-hewn rock (the default, dug out of the mountain),
 * board-formed poured concrete with a painted dado, and riveted steel plate.
 *
 * Every finish stands on the same concrete plinth with a steel rail at
 * `PLINTH_HEIGHT`: the cutaway material removes a wall above that height
 * (cutaway.ts), so the rail is the trim a cut wall shows. The top of an
 * uncut wall is a dark section cap, finished by the separate `wall_trim`
 * piece (a steel ceiling-edge angle). `wall_pillar` covers joints and
 * corners; `rock_pile` is rubble left at the foot of a rock wall.
 */
import { PLINTH_HEIGHT, TILE, WALL_HEIGHT, WALL_THICKNESS } from "../dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

const L = TILE;
const H = WALL_HEIGHT;
const T = WALL_THICKNESS;
const FRONT = T / 2;
/** How far the plinth stands proud of the wall face. */
const PLINTH_PROUD = 0.07;

export type WallFinish = "rock" | "concrete" | "steel";

/**
 * How far each finish's face stands proud of its wall line, metres: the
 * rock relief bulges up to this far, so anything hung on a rock wall (boards,
 * posters, clocks) must stand off by it or it sinks into the rock.
 */
export const WALL_RELIEF: Readonly<Record<WallFinish, number>> = {
  rock: 0.24,
  concrete: 0.01,
  steel: 0.06,
};

/**
 * Plinth, rail, back face, end faces and the dark section cap common to
 * every finish; `endFront` is how far the face stands out at the ends.
 */
function frame(b: PartBuilder, endFront = FRONT): void {
  b.box(
    [L, PLINTH_HEIGHT, T + PLINTH_PROUD],
    [0, PLINTH_HEIGHT / 2, PLINTH_PROUD / 2],
    LAIR.concreteDark,
    {
      jitter: 0.1,
    },
  );
  // The rail: a steel angle along the plinth top, with bolts.
  b.box([L, 0.05, 0.09], [0, PLINTH_HEIGHT + 0.025, FRONT + PLINTH_PROUD - 0.03], LAIR.steelDark);
  for (let x = -0.75; x <= 0.76; x += 0.5) {
    b.rivetZ(x, PLINTH_HEIGHT - 0.08, FRONT + PLINTH_PROUD + 0.001, LAIR.steel, 0.02);
  }
  // Back face (outside of the room) and the cut cap on top.
  const back = -T / 2;
  b.quad(
    [L / 2, PLINTH_HEIGHT, back],
    [-L / 2, PLINTH_HEIGHT, back],
    [-L / 2, H, back],
    [L / 2, H, back],
    LAIR.rockDark,
  );
  b.quad([-L / 2, H, FRONT], [L / 2, H, FRONT], [L / 2, H, back], [-L / 2, H, back], LAIR.rockCut);
  const y0 = PLINTH_HEIGHT;
  b.quad(
    [-L / 2, y0, back],
    [-L / 2, y0, endFront],
    [-L / 2, H, endFront],
    [-L / 2, H, back],
    LAIR.rockCut,
  );
  b.quad(
    [L / 2, y0, endFront],
    [L / 2, y0, back],
    [L / 2, H, back],
    [L / 2, H, endFront],
    LAIR.rockCut,
  );
}

/** Smooth seeded noise on the rock face lattice; zero at the left/right edges so segments tile. */
function rockDepth(b: PartBuilder, i: number, j: number, nx: number, ny: number): number {
  if (i === 0 || i === nx) return 0.05;
  if (j === ny) return 0;
  const ledge = j % 3 === 1 ? 0.05 : 0;
  return 0.03 + ledge + b.random() * 0.13;
}

export function rockWall(seed = 1): PieceGeometry {
  const b = new PartBuilder(seed);
  frame(b, FRONT + 0.05);
  const nx = 6;
  const ny = 7;
  const y0 = PLINTH_HEIGHT;
  const depth: number[][] = [];
  for (let i = 0; i <= nx; i++) {
    depth[i] = [];
    for (let j = 0; j <= ny; j++) depth[i]![j] = rockDepth(b, i, j, nx, ny);
  }
  // Jitter interior lattice points sideways too, so the facets are not a grid.
  const at = (i: number, j: number): [number, number, number] => {
    const inner = i > 0 && i < nx && j > 0 && j < ny;
    const jx = inner ? Math.sin(i * 12.9 + j * 78.2 + seed) * 0.5 * (L / nx) * 0.6 : 0;
    const jy = inner ? Math.cos(i * 39.3 + j * 11.7 + seed) * 0.5 * ((H - y0) / ny) * 0.6 : 0;
    return [
      -L / 2 + (i * L) / nx + jx,
      y0 + (j * (H - y0)) / ny + jy,
      FRONT + (depth[i]?.[j] ?? 0),
    ];
  };
  const tones = [LAIR.rock, LAIR.rock, LAIR.rockLight, LAIR.rockCool, LAIR.rockDark];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const tone = tones[Math.floor(b.random() * tones.length)] ?? LAIR.rock;
      // Lighter toward the top (dust and lamplight), darker at the foot.
      const k = 0.82 + 0.3 * (j / ny);
      const a = at(i, j);
      const c = at(i + 1, j);
      const d = at(i + 1, j + 1);
      const e = at(i, j + 1);
      // Alternate the split diagonal so the facets read as chipped rock.
      if ((i + j) % 2 === 0) {
        b.tri(a, c, d, tone, k * (0.95 + b.random() * 0.1)).tri(a, d, e, tone, k);
      } else {
        b.tri(a, c, e, tone, k).tri(c, d, e, tone, k * (0.95 + b.random() * 0.1));
      }
    }
  }
  // Close the plinth top behind the jagged face.
  b.panelY(-L / 2, FRONT, L / 2, FRONT + 0.05, PLINTH_HEIGHT + 0.001, LAIR.rockDark);
  return { body: b.build() };
}

export function concreteWall(seed = 2): PieceGeometry {
  const b = new PartBuilder(seed);
  frame(b);
  const z = FRONT;
  const dado = 1.35;
  // Painted dado (lived-in: scuffed), a yellow pinstripe, raw concrete above.
  b.panelZ(-L / 2, PLINTH_HEIGHT, L / 2, dado, z, LAIR.steelPaint, 0.95);
  b.panelZ(-L / 2, dado, L / 2, dado + 0.04, z, LAIR.yellow);
  // Board-formed concrete: courses of slightly different tone.
  const course = 0.33;
  let row = 0;
  for (let y = dado + 0.04; y < H - 1e-6; y += course, row++) {
    const top = Math.min(H, y + course);
    b.panelZ(
      -L / 2,
      y,
      L / 2,
      top,
      z,
      LAIR.concrete,
      0.9 + ((row * 7) % 3) * 0.05 + b.random() * 0.04,
    );
    b.panelZ(-L / 2, top - 0.012, L / 2, top, z + 0.002, LAIR.concreteDark);
  }
  // Panel joint and formwork tie holes.
  b.panelZ(-0.01, dado + 0.04, 0.01, H, z + 0.003, LAIR.concreteDark);
  for (const x of [-0.75, -0.25, 0.25, 0.75]) {
    for (const y of [1.75, 2.5])
      b.panelZ(x - 0.025, y - 0.025, x + 0.025, y + 0.025, z + 0.003, LAIR.steelDark);
  }
  // A drip stain under one tie hole.
  b.panelZ(0.23, 1.45, 0.27, 1.73, z + 0.002, LAIR.concreteDark, 0.95);
  return { body: b.build() };
}

export function steelWall(seed = 3): PieceGeometry {
  const b = new PartBuilder(seed);
  frame(b);
  const z = FRONT;
  const ribs = [-L / 2 + 0.03, 0, L / 2 - 0.03];
  const bands = [1.45, 2.35];
  // Plates between the ribs and bands, each its own tone (oil and wear).
  const ys = [PLINTH_HEIGHT, ...bands, H];
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < 2; c++) {
      const x0 = c === 0 ? -L / 2 : 0;
      b.panelZ(x0, ys[r] ?? 0, x0 + L / 2, ys[r + 1] ?? 0, z, LAIR.steel, 0.88 + b.random() * 0.14);
    }
  }
  for (const x of ribs) {
    const w = x === 0 ? 0.08 : 0.06;
    b.box([w, H - PLINTH_HEIGHT, 0.05], [x, (H + PLINTH_HEIGHT) / 2, z + 0.025], LAIR.steelDark);
    for (let y = PLINTH_HEIGHT + 0.2; y < H - 0.1; y += 0.3)
      b.rivetZ(x, y, z + 0.05, LAIR.steelLight, 0.016);
  }
  for (const y of bands) {
    b.box([L, 0.06, 0.04], [0, y, z + 0.02], LAIR.steelDark);
    for (let x = -0.8; x <= 0.81; x += 0.4) b.rivetZ(x, y, z + 0.04, LAIR.steelLight, 0.015);
  }
  // A stencilled red band at eye height: the lair's sector marking.
  b.panelZ(-L / 2, 1.62, L / 2, 1.7, z + 0.001, LAIR.red);
  return { body: b.build() };
}

/** The ceiling-edge trim: a steel angle capping the top of a wall, with bolts. */
export function wallTrim(): PieceGeometry {
  const b = new PartBuilder(4);
  b.box([L, 0.05, T + 0.12], [0, H + 0.025, 0.02], LAIR.steelDark);
  b.box([L, 0.16, 0.035], [0, H - 0.055, FRONT + 0.075], LAIR.steel);
  for (let x = -0.8; x <= 0.81; x += 0.4)
    b.rivetZ(x, H - 0.055, FRONT + 0.093, LAIR.steelLight, 0.018);
  return { body: b.build() };
}

/** A corner or joint column: concrete with a steel collar at the plinth and a cap. */
export function wallPillar(): PieceGeometry {
  const b = new PartBuilder(5);
  const s = T + 0.16;
  b.box([s, H, s], [0, H / 2, 0], LAIR.concreteDark, { jitter: 0.12 });
  b.box([s + 0.04, 0.18, s + 0.04], [0, PLINTH_HEIGHT - 0.05, 0], LAIR.steelDark);
  b.box([s + 0.06, 0.08, s + 0.06], [0, H + 0.04, 0], LAIR.steelDark);
  // Hazard wrap at knee height: people walk into corners.
  const stripe = new PartBuilder(6).hazardZ(-s / 2, 0.75, s / 2, 1.05, 0, 3).build();
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const r = s / 2 + 0.001;
    b.append(stripe, [Math.sin(yaw) * r, 0, Math.cos(yaw) * r], [0, yaw, 0]);
  }
  stripe.dispose();
  return { body: b.build() };
}

/** Rubble at the foot of a rock wall: a few boulders and grit. */
export function rockPile(seed = 7): PieceGeometry {
  const b = new PartBuilder(seed);
  b.boulder(0.32, [0, 0.2, 0], LAIR.rock, { scale: [1.2, 0.8, 1] });
  b.boulder(0.22, [0.42, 0.12, 0.12], LAIR.rockLight);
  b.boulder(0.16, [-0.38, 0.09, 0.18], LAIR.rockDark);
  b.boulder(0.1, [0.15, 0.06, 0.38], LAIR.rockCool);
  b.boulder(0.08, [-0.15, 0.05, 0.4], LAIR.rock);
  return { body: b.build() };
}

export const WALL_BUILDERS: Readonly<Record<WallFinish, () => PieceGeometry>> = {
  rock: rockWall,
  concrete: concreteWall,
  steel: steelWall,
};
