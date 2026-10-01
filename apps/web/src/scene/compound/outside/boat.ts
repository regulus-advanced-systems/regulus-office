/**
 * The boat at the dock (#188; D23: an original design): a 1960s mahogany
 * runabout, cream hull with a red boot stripe, varnished deck with cream
 * seams, a raked windscreen, two leather bench seats and an outboard. One
 * vertex-coloured mesh in its own frame: bow toward -z, waterline at y = 0.
 * Pure.
 */
import type { BufferGeometry } from "three";
import { PartBuilder, type Vec3 } from "../../lair/geometry/builder.ts";
import { LAIR } from "../../lair/palette.ts";

const HULL = "#EDE6D3";
const STRIPE = LAIR.red;
const DECK = "#7A4326";
const SEAM = "#E8DCC0";
const GLASS = "#9FD8DA";

/** Half beam of the hull at `t` from stern (0) to bow (1). */
function halfBeam(t: number): number {
  return t < 0.55 ? 1.05 : 1.05 * Math.cos(((t - 0.55) / 0.45) * (Math.PI / 2)) ** 0.7 + 0.02;
}

export const BOAT_LENGTH = 6.4;

export function boatGeometry(): BufferGeometry {
  const b = new PartBuilder(77);
  const L = BOAT_LENGTH;
  const n = 9;
  const zAt = (t: number) => L / 2 - t * L;
  const keel = -0.45;
  const sheer = (t: number) => 0.45 + t * 0.25;
  // Hull sides and bottom, section by section from stern to bow.
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const w0 = halfBeam(t0);
    const w1 = halfBeam(t1);
    const z0 = zAt(t0);
    const z1 = zAt(t1);
    for (const side of [-1, 1]) {
      const top0: Vec3 = [side * w0, sheer(t0), z0];
      const top1: Vec3 = [side * w1, sheer(t1), z1];
      const mid0: Vec3 = [side * w0 * 0.98, 0.08, z0];
      const mid1: Vec3 = [side * w1 * 0.98, 0.08, z1];
      const bot0: Vec3 = [side * w0 * 0.55, keel + t0 * 0.25, z0];
      const bot1: Vec3 = [side * w1 * 0.55, keel + t1 * 0.25, z1];
      const k0: Vec3 = [0, keel - 0.08 + t0 * 0.3, z0];
      const k1: Vec3 = [0, keel - 0.08 + t1 * 0.3, z1];
      const face = (a: Vec3, c: Vec3, d: Vec3, e: Vec3, color: string) =>
        side > 0 ? b.quad(a, c, d, e, color) : b.quad(e, d, c, a, color);
      face(mid0, mid1, top1, top0, HULL);
      face(bot0, bot1, mid1, mid0, STRIPE);
      face(k0, k1, bot1, bot0, LAIR.steelDark);
    }
    // Deck: varnished planking with a cream seam down the middle.
    const d0 = sheer(t0);
    const d1 = sheer(t1);
    b.quad([-w0, d0, z0], [w0, d0, z0], [w1, d1, z1], [-w1, d1, z1], DECK, 0.95 + (i % 2) * 0.1);
    b.quad(
      [-0.04, d0 + 0.005, z0],
      [0.04, d0 + 0.005, z0],
      [0.04, d1 + 0.005, z1],
      [-0.04, d1 + 0.005, z1],
      SEAM,
    );
  }
  // Transom.
  b.quad(
    [-1.05, 0.45, L / 2],
    [-0.58, keel, L / 2],
    [0.58, keel, L / 2],
    [1.05, 0.45, L / 2],
    HULL,
    0.85,
  );
  // Cockpit well, seats, windscreen and outboard.
  b.box([1.7, 0.08, 2.4], [0, 0.4, 0.55], LAIR.walnutDark);
  for (const z of [0.0, 1.35]) {
    b.box([1.6, 0.32, 0.6], [0, 0.6, z], LAIR.leather, { jitter: 0.06 });
    b.box([1.6, 0.42, 0.14], [0, 0.88, z + 0.3], LAIR.leather, {
      jitter: 0.06,
      rot: [-0.15, 0, 0],
    });
  }
  b.box([1.8, 0.5, 0.04], [0, 0.98, -0.75], GLASS, { rot: [-0.55, 0, 0] });
  b.box([1.85, 0.05, 0.06], [0, 1.2, -0.62], LAIR.chrome, { rot: [-0.55, 0, 0] });
  b.box([0.5, 0.75, 0.45], [0, 0.82, L / 2 + 0.15], LAIR.black, { jitter: 0.06 });
  b.box([0.14, 0.7, 0.14], [0, 0.2, L / 2 + 0.25], LAIR.steelDark);
  b.cylinder(0.04, 0.04, 0.9, 5, [-0.85, 0.85, -1.4], LAIR.chrome, { rot: [0, 0, 0] });
  b.box([0.2, 0.12, 0.02], [-0.85, 1.25, -1.4], LAIR.red);
  // Chrome cleats and a rope to the dock.
  for (const z of [-2.2, 2.6])
    b.box([0.08, 0.06, 0.25], [-0.95, sheer(0.5) + 0.05, z], LAIR.chrome);
  return b.build();
}
