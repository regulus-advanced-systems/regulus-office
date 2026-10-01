/**
 * Room doors (#183): a heavy steel frame that takes the place of one wall
 * segment, or two for the generator's two-tile doorways (room side toward +z), with chevron-striped jambs,
 * a riveted lintel, a header of rock above it and a socket for the red
 * alarm beacon; and the two sliding leaves that close the opening. The
 * leaves are their own piece so they can be instanced and animated
 * (SlidingDoors.tsx); the frame never moves.
 */
import { DOOR_OPENING, PLINTH_HEIGHT, TILE, WALL_HEIGHT, WALL_THICKNESS } from "../dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

const H = WALL_HEIGHT;
const T = WALL_THICKNESS;
const OW = DOOR_OPENING.w;
const OH = DOOR_OPENING.h;
/** Jamb width each side: what is left of a tile after the one-tile opening. */
const JAMB = (TILE - OW) / 2;

/** Clear opening of a door `span` tiles wide. */
export function doorOpening(span = 1): number {
  return span * TILE - 2 * JAMB;
}
/** Depth of the frame, proud of the wall on both sides. */
const FRAME_D = T + 0.14;

/** Where the beacon sits on a door frame (local space, room side). */
export const DOOR_BEACON_POS = [0, OH + 0.36, T / 2 + 0.1] as const;
/** Leaf size: each leaf covers half the opening plus an overlap into the jamb. */
export const DOOR_LEAF = { w: OW / 2 + 0.06, h: OH + 0.04, d: 0.07 } as const;

export function doorFrame(span = 1): PieceGeometry {
  const L = span * TILE;
  const OW = doorOpening(span);
  const b = new PartBuilder(21);
  for (const side of [-1, 1]) {
    const x = side * (OW / 2 + JAMB / 2);
    b.box([JAMB, OH + 0.2, FRAME_D], [x, (OH + 0.2) / 2, 0], LAIR.steelDark);
    // Chevrons on both faces of each jamb.
    const stripes = new PartBuilder(22)
      .hazardZ(-JAMB / 2 + 0.03, 0.2, JAMB / 2 - 0.03, OH - 0.1, 0, 7)
      .build();
    b.append(stripes, [x, 0, FRAME_D / 2 + 0.001]);
    b.append(stripes, [x, 0, -FRAME_D / 2 - 0.001], [0, Math.PI, 0]);
    stripes.dispose();
    for (const y of [0.35, OH / 2, OH - 0.25])
      b.rivetZ(side * (OW / 2 + 0.04), y, FRAME_D / 2, LAIR.steelLight, 0.02);
    // The leaves slide into a pocket: a dark slot in the inner jamb face.
    b.box([0.01, OH, DOOR_LEAF.d + 0.02], [side * (OW / 2 + 0.006), OH / 2, 0], LAIR.black);
  }
  // Lintel: a riveted steel beam spanning the tile.
  b.box([L, 0.28, FRAME_D + 0.04], [0, OH + 0.14, 0], LAIR.steel);
  for (let x = -L / 2 + 0.15; x <= L / 2 - 0.14; x += 0.34) {
    b.rivetZ(x, OH + 0.06, FRAME_D / 2 + 0.02, LAIR.steelLight, 0.02);
    b.rivetZ(x, OH + 0.22, FRAME_D / 2 + 0.02, LAIR.steelLight, 0.02);
  }
  // Header of rock above the lintel, up to the wall top, with the cut cap.
  const hy = OH + 0.28;
  b.box([L, H - hy, T], [0, hy + (H - hy) / 2, 0], LAIR.rock, { jitter: 0.25 });
  b.panelY(-L / 2, -T / 2, L / 2, T / 2, H + 0.001, LAIR.rockCut);
  // Beacon sockets, one over each face.
  b.box(
    [0.26, 0.06, 0.16],
    [DOOR_BEACON_POS[0], DOOR_BEACON_POS[1] - 0.05, -(DOOR_BEACON_POS[2] - 0.02)],
    LAIR.steelDark,
  );
  b.box(
    [0.26, 0.06, 0.16],
    [DOOR_BEACON_POS[0], DOOR_BEACON_POS[1] - 0.05, DOOR_BEACON_POS[2] - 0.02],
    LAIR.steelDark,
  );
  // Floor track the leaves run in, and a threshold plate.
  b.box([L, 0.02, 0.24], [0, 0.01, 0], LAIR.steelDark);
  b.box([OW, 0.012, 0.6], [0, 0.006, 0], LAIR.steel, { jitter: 0.08 });
  // A plinth stub either side, so the frame meets the wall's plinth rail.
  for (const side of [-1, 1]) {
    b.box(
      [0.04, PLINTH_HEIGHT, FRAME_D + 0.02],
      [side * (L / 2 - 0.02), PLINTH_HEIGHT / 2, 0],
      LAIR.concreteDark,
    );
  }
  return { body: b.build() };
}

/**
 * One sliding leaf, centred at its own origin (x across, the bottom at
 * y = 0): riveted plate, a horizontal reinforcing rib, a vision slot with
 * teal glass, and a hazard kick plate. The right leaf is this one mirrored.
 */
export function doorLeaf(): PieceGeometry {
  const b = new PartBuilder(23);
  const { w, h, d } = DOOR_LEAF;
  b.box([w, h, d], [0, h / 2, 0], LAIR.steelPaint, { jitter: 0.06 });
  for (const z of [d / 2, -d / 2]) {
    const face = z > 0 ? 0 : Math.PI;
    const rib = new PartBuilder(24);
    rib.box([w - 0.08, 0.1, 0.03], [0, h * 0.55, 0.015], LAIR.steelDark);
    rib.box([0.08, h - 0.4, 0.03], [w / 2 - 0.1, h / 2 + 0.1, 0.015], LAIR.steelDark);
    for (let y = 0.3; y < h - 0.1; y += 0.35)
      rib.rivetZ(-w / 2 + 0.06, y, 0, LAIR.steelLight, 0.018);
    rib.hazardZ(-w / 2 + 0.02, 0.04, w / 2 - 0.02, 0.32, 0.002, 5);
    rib.panelZ(-0.2, h * 0.7, 0.12, h * 0.7 + 0.1, 0.003, LAIR.black);
    const part = rib.build();
    b.append(part, [0, 0, z], [0, face, 0]);
    part.dispose();
  }
  // Vision slot glass glows faintly teal from the lit room behind it.
  const glow = new PartBuilder(25);
  glow.box([0.28, 0.07, d + 0.012], [-0.04, h * 0.7 + 0.05, 0], LAIR.teal);
  return { body: b.build(), glow: glow.build() };
}

/** Width of each leaf of a door `span` tiles wide (half the opening plus the overlap). */
export function leafWidth(span = 1): number {
  return doorOpening(span) / 2 + 0.06;
}

/** Local x of each leaf's centre for an openness in [0, 1] (0 closed, 1 fully in the pockets). */
export function leafOffsets(openness: number, span = 1): { left: number; right: number } {
  const o = Math.min(1, Math.max(0, openness));
  const lw = leafWidth(span);
  const closed = lw / 2 - 0.03;
  const open = doorOpening(span) / 2 + lw / 2 - 0.08;
  const x = closed + (open - closed) * o;
  return { left: -x, right: x };
}
