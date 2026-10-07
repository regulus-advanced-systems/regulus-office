/**
 * The lift and sealed doors (#269, SPEC §14 D26): the lair's levels are dug
 * into one mountain and joined by a single shaft.
 *
 * - `liftShaft`: the shaft's housing as it stands in the lobby and on every
 *   level's landing: poured-concrete cheeks and back, steel pylons with
 *   hazard chevrons either side of the doorway, a brass call plate with a lit
 *   button and direction arrows. The 3/4 camera looks down into it, so the
 *   top is open: the cabin's roof with its hatch and lamp strips sits below a
 *   hazard-striped rim, under the headgear (two beams, the sheave wheel, the
 *   winch and its red lamp). The doorway itself takes a standard one-tile
 *   door frame and its two sliding leaves (doors.ts, SlidingDoors.tsx), and
 *   the level indicator hangs on the frame's header (compound/lift/). Door
 *   side toward +z. Kept lean: the kit's whole triangle budget is nearly used.
 * - `doorBars`: two steel beams and a brace welded across a room's two-tile
 *   door, with a red lamp on the seal: the door of a room this viewer may
 *   not enter. Corridor side toward +z.
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
  // Cheeks and back: poured concrete, a chevron band at the foot and a steel waist rail outside.
  const cheek = new PartBuilder(78)
    .hazardZ(-(d - 0.5) / 2 + 0.1, 0.12, (d - 0.5) / 2 - 0.1, 0.5, 0, 4)
    .build();
  for (const side of [-1, 1]) {
    b.box([0.3, h, d - 0.5], [side * (w / 2 - 0.15), h / 2, -0.25], LAIR.concreteDark, {
      jitter: 0.1,
    });
    b.append(cheek, [side * (w / 2 + 0.002), 0, -0.25], [0, (side * Math.PI) / 2, 0]);
    b.box([0.06, 0.12, d - 0.5], [side * (w / 2 + 0.03), 1.5, -0.25], LAIR.steel);
  }
  cheek.dispose();
  b.box([w, h, 0.3], [0, h / 2, -front + 0.15], LAIR.concreteDark, { jitter: 0.1 });
  // Pylons either side of the door frame: steel with a chevron band.
  const band = new PartBuilder(73)
    .hazardZ(-pylon / 2 + 0.04, 0.12, pylon / 2 - 0.04, 0.62, 0, 3)
    .build();
  for (const side of [-1, 1]) {
    const x = side * (TILE / 2 + pylon / 2);
    b.box([pylon, h, 0.5], [x, h / 2, front - 0.25], LAIR.steel, { jitter: 0.06 });
    b.append(band, [x, 0, front + 0.002]);
  }
  band.dispose();
  // Call plate on the left pylon: brass with a lit button.
  const cx = -(TILE / 2 + pylon / 2);
  b.box([0.3, 0.44, 0.04], [cx, 1.25, front + 0.02], LAIR.brass);
  glow.box([0.1, 0.1, 0.03], [cx, 1.34, front + 0.05], LAIR.tungstenGlow);
  // Direction arrows on the right pylon: up teal, down amber.
  const ax = TILE / 2 + pylon / 2;
  const z = front + 0.023;
  b.box([0.3, 0.5, 0.02], [ax, 1.3, front + 0.01], LAIR.black);
  glow.tri([ax - 0.09, 1.38, z], [ax + 0.09, 1.38, z], [ax, 1.5, z], LAIR.teal);
  glow.tri([ax + 0.09, 1.22, z], [ax - 0.09, 1.22, z], [ax, 1.1, z], LAIR.tungsten);
  // The cabin: plate floor and a painted back panel.
  b.box([TILE, 0.04, d - 0.6], [0, 0.02, -0.1], LAIR.steel, { jitter: 0.08 });
  b.box([TILE + 0.3, 2.5, 0.05], [0, 1.25, -front + 0.33], LAIR.steelPaint, { jitter: 0.06 });
  // Seen from above (the 3/4 camera) the shaft is open: the cabin's roof sits below
  // the rim with its hatch and lamp strips, and the cable runs up to the headgear.
  const roofY = 2.56;
  b.box([TILE + 0.3, 0.06, d - 0.6], [0, roofY, -0.1], LAIR.steelPaint, { jitter: 0.06 });
  b.box([0.7, 0.05, 0.7], [-0.45, roofY + 0.05, -0.25], LAIR.brass);
  for (const side of [-1, 1])
    glow.box(
      [0.06, 0.03, d - 0.9],
      [side * (TILE / 2 + 0.02), roofY + 0.05, -0.1],
      LAIR.tungstenGlow,
    );
  b.box([0.07, h + 0.55 - roofY, 0.05], [0.55, (h + 0.55 + roofY) / 2, -0.1], LAIR.black);
  // The rim: a hazard-striped curb at the front and back of the shaft's top.
  const curb = new PartBuilder(76).hazardZ(-w / 2, -0.15, w / 2, 0.15, 0, 7).build();
  for (const zc of [front - 0.15, -front + 0.15])
    b.append(curb, [0, h + 0.002, zc], [-Math.PI / 2, 0, 0]);
  curb.dispose();
  // Headgear: two beams across the shaft carrying the sheave wheel and the winch.
  for (const zb of [-0.42, 0.22])
    b.box([w + 0.2, 0.2, 0.16], [0, h + 0.12, zb], LAIR.steelDark, { jitter: 0.06 });
  b.cylinder(0.44, 0.44, 0.1, 10, [0.55, h + 0.56, -0.1], LAIR.steelLight, {
    rot: [Math.PI / 2, 0, 0],
  });
  b.box([0.2, 0.2, 0.8], [0.55, h + 0.56, -0.1], LAIR.steelDark);
  b.box([0.9, 0.5, 0.8], [-0.85, h + 0.5, -0.1], LAIR.steelPaint, { jitter: 0.06 });
  glow.box([0.16, 0.1, 0.16], [-1.05, h + 0.8, -0.1], LAIR.red);
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
    b.box([span, 0.2, 0.12], [0, y, 0], LAIR.steelDark, { jitter: 0.08 });
  }
  // Weld plates down each jamb.
  for (const side of [-1, 1])
    b.box([0.36, 1.5, 0.05], [side * (span / 2 - 0.16), 1.25, 0.07], LAIR.steel, { jitter: 0.08 });
  const rise = 1;
  const run = open - 0.4;
  b.box([Math.hypot(run, rise), 0.12, 0.08], [0, 1.25, -0.01], LAIR.steelDark, {
    rot: [0, 0, Math.atan2(rise, run)],
    jitter: 0.08,
  });
  // The seal in the middle: a square plate set on its corner, with a red lamp.
  b.box([0.5, 0.5, 0.07], [0, 1.25, 0.07], LAIR.steel, { rot: [0, 0, Math.PI / 4] });
  glow.box([0.14, 0.14, 0.03], [0, 1.25, 0.12], LAIR.red);
  return { body: b.build(), glow: glow.build() };
}
