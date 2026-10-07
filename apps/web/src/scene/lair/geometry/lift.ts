/**
 * The lift and sealed doors (#269, SPEC §14 D26): the lair's levels are dug
 * into one mountain and joined by a single shaft.
 *
 * - `liftShaft`: the shaft's housing as it stands in the lobby and on every
 *   level's landing: poured-concrete cheeks and back, steel pylons with
 *   hazard chevrons either side of the doorway, a call plate with a lit
 *   button, the cabin behind (plate floor, handrail, a warm cabin lamp) and a
 *   winch housing with its cable wheel on top. The doorway itself takes a
 *   standard one-tile door frame and its two sliding leaves (doors.ts,
 *   SlidingDoors.tsx), and the level indicator hangs on the frame's header
 *   (compound/lift/). Door side toward +z.
 * - `doorBars`: steel beams welded across a room's two-tile door, with a red
 *   lamp: the door of a room this viewer may not enter. Corridor side toward +z.
 */
import { TILE, WALL_HEIGHT } from "../dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";
import { doorOpening } from "./doors.ts";

/** The housing: `w` along the wall, `d` out from it (room-layout `LIFT_SIZE`), `h` to the roof. */
export const LIFT_SHAFT = { w: 3.2, d: 2.4, h: WALL_HEIGHT } as const;
/** How far behind the housing's front face the door's plane is (the frame sits in the pylons). */
export const LIFT_DOOR_INSET = 0.25;

export function liftShaft(): PieceGeometry {
  const { w, d, h } = LIFT_SHAFT;
  const b = new PartBuilder(71);
  const glow = new PartBuilder(72);
  const front = d / 2;
  const pylon = (w - TILE) / 2;
  // Cheeks and back: poured concrete, darker at the back.
  const cheek = new PartBuilder(78)
    .hazardZ(-(d - 0.5) / 2 + 0.1, 0.12, (d - 0.5) / 2 - 0.1, 0.5, 0, 6)
    .build();
  for (const side of [-1, 1]) {
    b.box([0.3, h, d - 0.5], [side * (w / 2 - 0.15), h / 2, -0.25], LAIR.concreteDark, {
      jitter: 0.1,
    });
    // Outside: a chevron band at the foot, a steel waist rail and a riveted corner post.
    b.append(cheek, [side * (w / 2 + 0.002), 0, -0.25], [0, (side * Math.PI) / 2, 0]);
    b.box([0.06, 0.12, d - 0.5], [side * (w / 2 + 0.03), 1.5, -0.25], LAIR.steel);
    b.box([0.16, h, 0.16], [side * (w / 2 - 0.02), h / 2, -front + 0.08], LAIR.steelDark);
  }
  cheek.dispose();
  b.box([w, h, 0.3], [0, h / 2, -front + 0.15], LAIR.concreteDark, { jitter: 0.1 });
  // Pylons either side of the door frame: riveted steel with a chevron band.
  for (const side of [-1, 1]) {
    const x = side * (TILE / 2 + pylon / 2);
    b.box([pylon, h, 0.5], [x, h / 2, front - 0.25], LAIR.steel, { jitter: 0.06 });
    const band = new PartBuilder(73).hazardZ(-pylon / 2 + 0.04, 0.12, pylon / 2 - 0.04, 0.62, 0, 4);
    const part = band.build();
    b.append(part, [x, 0, front + 0.002]);
    part.dispose();
    for (const y of [0.9, 1.5, 2.1, 2.7])
      for (const dx of [-0.2, 0.2]) b.rivetZ(x + dx, y, front, LAIR.steelLight, 0.022);
  }
  // Call plate on the left pylon: brass, a lit button and a key switch.
  const cx = -(TILE / 2 + pylon / 2);
  b.box([0.3, 0.44, 0.04], [cx, 1.25, front + 0.02], LAIR.brass);
  b.box([0.06, 0.1, 0.03], [cx, 1.13, front + 0.05], LAIR.black);
  glow.cylinder(0.06, 0.06, 0.03, 10, [cx, 1.34, front + 0.05], LAIR.tungstenGlow, {
    rot: [Math.PI / 2, 0, 0],
  });
  // Direction arrows on the right pylon: up teal, down amber.
  const ax = TILE / 2 + pylon / 2;
  const z = front + 0.012;
  b.box([0.3, 0.5, 0.02], [ax, 1.3, front + 0.01], LAIR.black);
  glow.tri(
    [ax - 0.09, 1.38, z + 0.011],
    [ax + 0.09, 1.38, z + 0.011],
    [ax, 1.5, z + 0.011],
    LAIR.teal,
  );
  glow.tri(
    [ax + 0.09, 1.22, z + 0.011],
    [ax - 0.09, 1.22, z + 0.011],
    [ax, 1.1, z + 0.011],
    LAIR.tungsten,
  );
  // The cabin: plate floor, painted panels, a handrail and a warm lamp inside.
  b.box([TILE, 0.04, d - 0.6], [0, 0.02, -0.1], LAIR.steel, { jitter: 0.08 });
  b.box([TILE + 0.3, 2.5, 0.05], [0, 1.25, -front + 0.33], LAIR.steelPaint, { jitter: 0.06 });
  for (const side of [-1, 1])
    b.box([0.05, 2.5, d - 0.7], [side * (TILE / 2 + 0.12), 1.25, -0.12], LAIR.olive, {
      jitter: 0.06,
    });
  b.box([TILE, 0.05, 0.05], [0, 1.02, -front + 0.42], LAIR.chrome);
  glow.box([0.7, 0.03, 0.4], [0, 2.49, -0.1], LAIR.tungstenGlow);
  // Seen from above (the 3/4 camera) the shaft is open: the cabin's roof sits below
  // the rim with its hatch and lamp strips, and the cables run up to the headgear.
  const roofY = 2.56;
  b.box([TILE + 0.3, 0.06, d - 0.6], [0, roofY, -0.1], LAIR.steelPaint, { jitter: 0.06 });
  b.box([0.7, 0.05, 0.7], [-0.45, roofY + 0.05, -0.25], LAIR.brass);
  b.box([0.5, 0.05, 0.08], [-0.45, roofY + 0.09, -0.25], LAIR.steelDark);
  for (const side of [-1, 1])
    glow.box(
      [0.06, 0.03, d - 0.9],
      [side * (TILE / 2 + 0.02), roofY + 0.05, -0.1],
      LAIR.tungstenGlow,
    );
  for (const dx of [-0.07, 0.07])
    b.box([0.035, h + 0.55 - roofY, 0.035], [0.55 + dx, (h + 0.55 + roofY) / 2, -0.1], LAIR.black);
  // The rim: a hazard-striped steel curb round the top of the shaft.
  const curb = new PartBuilder(76).hazardZ(-w / 2, -0.15, w / 2, 0.15, 0, 9).build();
  for (const z of [front - 0.15, -front + 0.15])
    b.append(curb, [0, h + 0.002, z], [-Math.PI / 2, 0, 0]);
  curb.dispose();
  const sideCurb = new PartBuilder(77)
    .hazardZ(-(d - 0.6) / 2, -0.15, (d - 0.6) / 2, 0.15, 0, 6)
    .build();
  for (const side of [-1, 1])
    b.append(sideCurb, [side * (w / 2 - 0.15), h + 0.002, 0], [-Math.PI / 2, 0, Math.PI / 2]);
  sideCurb.dispose();
  // Headgear: two beams across the shaft carrying the sheave wheel and the winch.
  for (const z of [-0.42, 0.22]) {
    b.box([w + 0.2, 0.2, 0.16], [0, h + 0.12, z], LAIR.steelDark, { jitter: 0.06 });
    b.box([w + 0.2, 0.04, 0.24], [0, h + 0.23, z], LAIR.steel);
  }
  b.cylinder(0.44, 0.44, 0.1, 14, [0.55, h + 0.56, -0.1], LAIR.steelLight, {
    rot: [Math.PI / 2, 0, 0],
  });
  b.cylinder(0.3, 0.3, 0.12, 14, [0.55, h + 0.56, -0.1], LAIR.steelDark, {
    rot: [Math.PI / 2, 0, 0],
  });
  b.cylinder(0.08, 0.08, 0.9, 8, [0.55, h + 0.56, -0.1], LAIR.steel, { rot: [Math.PI / 2, 0, 0] });
  b.box([0.9, 0.5, 0.8], [-0.85, h + 0.5, -0.1], LAIR.steelPaint, { jitter: 0.06 });
  b.box([0.7, 0.06, 0.6], [-0.85, h + 0.78, -0.1], LAIR.steelDark);
  b.cylinder(0.14, 0.14, 0.5, 8, [-0.2, h + 0.5, -0.1], LAIR.brass, { rot: [0, 0, Math.PI / 2] });
  glow.box([0.16, 0.1, 0.16], [-1.05, h + 0.86, -0.1], LAIR.red);
  return { body: b.build(), glow: glow.build() };
}

/** How far proud of the door's plane the bars stand (they sit on the frame's corridor face). */
export const DOOR_BARS_OUT = 0.3;

export function doorBars(): PieceGeometry {
  const b = new PartBuilder(74);
  const glow = new PartBuilder(75);
  const open = doorOpening(2);
  const span = open + 0.5;
  // Two beams across the doorway and a diagonal brace between them.
  for (const y of [0.75, 1.75]) {
    b.box([span, 0.18, 0.1], [0, y, 0], LAIR.steelDark, { jitter: 0.08 });
    b.box([span, 0.04, 0.14], [0, y + 0.09, 0], LAIR.steel);
    b.box([span, 0.04, 0.14], [0, y - 0.09, 0], LAIR.steel);
    for (const side of [-1, 1]) {
      // Weld plates on the jambs, riveted.
      const x = side * (span / 2 - 0.16);
      b.box([0.36, 0.34, 0.05], [x, y, 0.06], LAIR.steel);
      for (const [dx, dy] of [
        [-0.11, -0.1],
        [0.11, -0.1],
        [-0.11, 0.1],
        [0.11, 0.1],
      ] as const)
        b.rivetZ(x + dx, y + dy, 0.085, LAIR.steelLight, 0.024);
    }
  }
  const rise = 1;
  const run = open - 0.4;
  b.box([Math.hypot(run, rise), 0.12, 0.08], [0, 1.25, -0.01], LAIR.steelDark, {
    rot: [0, 0, Math.atan2(rise, run)],
    jitter: 0.08,
  });
  // The seal in the middle: a round plate with a red lamp.
  b.cylinder(0.3, 0.3, 0.06, 12, [0, 1.25, 0.07], LAIR.steel, { rot: [Math.PI / 2, 0, 0] });
  b.cylinder(0.2, 0.2, 0.04, 12, [0, 1.25, 0.11], LAIR.black, { rot: [Math.PI / 2, 0, 0] });
  glow.cylinder(0.09, 0.09, 0.04, 10, [0, 1.25, 0.14], LAIR.red, { rot: [Math.PI / 2, 0, 0] });
  return { body: b.build(), glow: glow.build() };
}
