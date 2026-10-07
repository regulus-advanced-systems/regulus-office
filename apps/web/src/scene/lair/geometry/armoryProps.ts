/**
 * The armory decor style's own pieces (#282, on the #182 model ids and the
 * #183 kit): an armourer's bench, a weapon rack of ray blasters, a gun
 * locker, a corner stack of ammo crates, a display shell, a painted deck
 * floor and a target sheet for the wall. All original and procedural (D23),
 * in the kit's olive, gunmetal and brass with a signal-orange accent. Fronts
 * toward +z; floor pieces stand on y = 0.
 */
import { TILE } from "../dimensions.ts";
import { LAIR } from "../palette.ts";
import { PartBuilder, type PieceGeometry } from "./builder.ts";

/** The armory's accent: signal orange on muzzles, stencils and warning bands. */
export const ARMORY_ORANGE = "#F28C28";
const OLIVE_DARK = "#434D38";
const DECK = "#3E4A42";
const DECK_DARK = "#2F3833";

/** A retro ray blaster lying along +x from `x`, its grip down: stock, body, barrel, orange muzzle. */
function blasterFlat(b: PartBuilder, x: number, y: number, z: number): void {
  b.box([0.16, 0.06, 0.04], [x, y + 0.03, z], LAIR.walnut);
  b.box([0.26, 0.07, 0.05], [x + 0.2, y + 0.035, z], LAIR.steelDark);
  b.box([0.22, 0.03, 0.03], [x + 0.43, y + 0.04, z], LAIR.steelLight);
  b.box([0.05, 0.05, 0.05], [x + 0.56, y + 0.04, z], ARMORY_ORANGE);
}

/** The same blaster standing muzzle-up in a rack at `x`, its butt at `y`. */
function blasterUpright(b: PartBuilder, x: number, y: number, z: number): void {
  b.box([0.07, 0.3, 0.05], [x, y + 0.15, z], LAIR.walnut);
  b.box([0.08, 0.36, 0.06], [x, y + 0.48, z], LAIR.steelDark);
  b.box([0.035, 0.34, 0.035], [x, y + 0.83, z], LAIR.steelLight);
  b.box([0.06, 0.06, 0.06], [x, y + 1.03, z], ARMORY_ORANGE);
}

/** An armourer's bench, 1.8 x 0.8 m, its rubber-matted top at `top` metres. */
export function armoryBench(top = 0.76): PieceGeometry {
  const b = new PartBuilder(401);
  const w = 1.8;
  const d = 0.8;
  b.box([w, 0.06, d], [0, top - 0.03, 0], LAIR.olive, { jitter: 0.08 });
  b.panelY(-w / 2 + 0.06, -d / 2 + 0.06, w / 2 - 0.06, d / 2 - 0.06, top + 0.001, LAIR.black, 1.6);
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      b.box(
        [0.07, top - 0.06, 0.07],
        [x * (w / 2 - 0.07), (top - 0.06) / 2, z * (d / 2 - 0.07)],
        LAIR.steelDark,
      );
  b.box([w - 0.14, 0.03, d - 0.14], [0, 0.16, 0], LAIR.steel);
  // A drawer block with an orange stencil band, and an ammo tin on the lower shelf.
  b.box([0.5, 0.3, 0.5], [0.5, top - 0.21, 0], OLIVE_DARK);
  b.panelZ(0.28, top - 0.24, 0.72, top - 0.2, 0.251, ARMORY_ORANGE);
  b.box([0.34, 0.2, 0.22], [-0.5, 0.275, 0.05], LAIR.olive);
  b.box([0.2, 0.02, 0.03], [-0.5, 0.39, 0.05], LAIR.steelLight);
  // On the mat, clear of the four laptops: a blaster stripped for cleaning and an oil can.
  blasterFlat(b, -0.28, top, 0);
  b.cylinder(0.035, 0.045, 0.09, 6, [0.42, top + 0.045, 0.02], LAIR.brass);
  return { body: b.build() };
}

/** A wall rack, 1.2 x 1.75 x 0.4 m: four blasters standing muzzle-up behind a retaining bar. */
export function weaponRack(): PieceGeometry {
  const b = new PartBuilder(402);
  const w = 1.2;
  const h = 1.75;
  b.box([w, h, 0.05], [0, h / 2, -0.175], LAIR.steelDark, { jitter: 0.06 });
  b.box([w, 0.22, 0.4], [0, 0.11, 0], LAIR.olive, { jitter: 0.08 });
  b.box([w, 0.05, 0.3], [0, h - 0.025, -0.05], LAIR.olive);
  for (const x of [-1, 1]) b.box([0.05, h, 0.3], [x * (w / 2 - 0.025), h / 2, -0.05], LAIR.olive);
  b.box([w - 0.1, 0.04, 0.04], [0, 0.95, 0.1], LAIR.steelLight);
  for (let k = 0; k < 4; k++) blasterUpright(b, -0.39 + k * 0.26, 0.22, 0.02);
  b.hazardZ(-w / 2, 0.02, w / 2, 0.1, 0.201, 8);
  return { body: b.build() };
}

/** A two-door gun locker, 1.0 x 1.45 x 0.45 m, with mesh windows, a padlock and a helmet on top. */
export function gunLocker(): PieceGeometry {
  const b = new PartBuilder(403);
  const w = 1;
  const h = 1.45;
  const d = 0.45;
  const f = d / 2 + 0.001;
  b.box([w + 0.04, 0.08, d], [0, 0.04, 0], LAIR.black);
  b.box([w, h - 0.08, d], [0, 0.08 + (h - 0.08) / 2, 0], LAIR.olive, { jitter: 0.08 });
  for (const side of [-1, 1]) {
    const x = side * 0.25;
    b.panelZ(x - 0.22, 0.14, x + 0.22, h - 0.06, f, OLIVE_DARK);
    // Wire-mesh window: a dark pane with the blasters' orange muzzles showing behind it.
    b.panelZ(x - 0.16, 0.85, x + 0.16, 1.28, f + 0.001, LAIR.black, 1.5);
    for (const dx of [-0.08, 0.02, 0.1])
      b.panelZ(x + dx - 0.015, 1.14, x + dx + 0.015, 1.2, f + 0.002, ARMORY_ORANGE);
    b.box([0.03, 0.14, 0.03], [side * 0.05, 0.7, d / 2 + 0.015], LAIR.chrome);
  }
  b.box([0.08, 0.1, 0.04], [0, 0.56, d / 2 + 0.02], LAIR.brass);
  b.panelZ(-w / 2, 0.14, w / 2, 0.2, f + 0.001, ARMORY_ORANGE);
  b.sphere(0.14, 8, 4, [-0.22, h + 0.03, 0], LAIR.steelPaint, { scale: [1, 0.8, 1.15] });
  return { body: b.build() };
}

/** A corner stack of three olive ammo crates, 0.8 m square, with a brass shell lying on top. */
export function ammoCrates(): PieceGeometry {
  const b = new PartBuilder(404);
  const crates = [
    [0.78, 0.36, 0.78, 0, 0.18, 0, 0],
    [0.7, 0.3, 0.52, -0.03, 0.51, -0.1, 0.1],
    [0.5, 0.26, 0.4, 0.06, 0.79, -0.06, -0.22],
  ] as const;
  for (const [w, h, d, x, y, z, rot] of crates) {
    b.box([w, h, d], [x, y, z], LAIR.olive, { rot: [0, rot, 0], jitter: 0.12 });
    b.box([w + 0.02, 0.04, d + 0.02], [x, y + h / 2 - 0.02, z], OLIVE_DARK, { rot: [0, rot, 0] });
    b.box([w * 0.5, 0.07, 0.01], [x, y - 0.02, z + d / 2 + 0.006], ARMORY_ORANGE, {
      rot: [0, rot, 0],
    });
  }
  b.cylinder(0.05, 0.05, 0.3, 8, [0.02, 0.97, -0.02], LAIR.brass, {
    rot: [0, 0.5, Math.PI / 2],
    smooth: true,
  });
  return { body: b.build() };
}

/** A display shell on a plinth, 0.4 m square and 1.0 m tall: brass case, olive body, orange tip. */
export function shellStand(): PieceGeometry {
  const b = new PartBuilder(405);
  b.box([0.4, 0.14, 0.4], [0, 0.07, 0], LAIR.steelDark);
  b.panelZ(-0.14, 0.04, 0.14, 0.1, 0.201, LAIR.brass);
  b.cylinder(0.13, 0.14, 0.34, 8, [0, 0.31, 0], LAIR.brass, { smooth: true });
  b.cylinder(0.125, 0.13, 0.26, 8, [0, 0.61, 0], LAIR.olive, { smooth: true });
  b.cylinder(0.128, 0.128, 0.04, 8, [0, 0.5, 0], ARMORY_ORANGE, { smooth: true });
  b.cone(0.125, 0.26, 8, [0, 0.87, 0], ARMORY_ORANGE, { smooth: true });
  return { body: b.build() };
}

/** Armory floor: an olive painted deck tile with a worn lane and an orange line on two edges (it tiles). */
export function armoryFloor(): PieceGeometry {
  const b = new PartBuilder(406);
  const H = TILE / 2;
  b.box([TILE, 0.08, TILE], [0, -0.044, 0], DECK_DARK);
  b.panelY(-H, -H, H, H, 0, DECK, 0.96);
  // Four painted plates with a dark seam between them.
  for (const x0 of [-H, 0])
    for (const z0 of [-H, 0])
      b.panelY(
        x0 + 0.015,
        z0 + 0.015,
        x0 + H - 0.015,
        z0 + H - 0.015,
        0.001,
        DECK,
        1.02 + b.random() * 0.1,
      );
  b.panelY(-H, -H, H, -H + 0.03, 0.002, ARMORY_ORANGE, 0.7);
  b.panelY(-H, -H, -H + 0.03, H, 0.002, ARMORY_ORANGE, 0.7);
  b.panelY(-0.5, 0.15, 0.35, 0.7, 0.002, DECK_DARK, 1.15);
  return { body: b.build() };
}
