/**
 * Flat stand-ins for the floor tiles in the low detail tier (#190): the kit's
 * floors carry joints, stains and tread diamonds (60 to 200 triangles a
 * tile), which software WebGL pays for on every tile of every room in view.
 * The stand-in is one quad over the tile's top in its mean colour, so a room
 * still reads as concrete, steel deck, lab tile or carpet.
 */
import { BufferAttribute, BufferGeometry } from "three";
import type { PieceGeometry } from "./geometry/builder.ts";
import type { PieceId } from "./kit.ts";

export const LITE_FLOORS: ReadonlySet<PieceId> = new Set<PieceId>([
  "floor_concrete",
  "floor_concrete_worn",
  "floor_steel",
  "floor_tile",
  "floor_carpet",
]);

/** Area-weighted mean colour of the up-facing triangles, and the top's extent and height. */
function topOf(g: BufferGeometry) {
  const pos = g.getAttribute("position");
  const col = g.getAttribute("color");
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  const sum = [0, 0, 0];
  let area = 0;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const az = pos.getZ(i);
    const ux = pos.getX(i + 1) - ax;
    const uy = pos.getY(i + 1) - ay;
    const uz = pos.getZ(i + 1) - az;
    const vx = pos.getX(i + 2) - ax;
    const vy = pos.getY(i + 2) - ay;
    const vz = pos.getZ(i + 2) - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0 || ny / len < 0.9) continue;
    const a = len / 2;
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k);
      const z = pos.getZ(i + k);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      top = Math.max(top, pos.getY(i + k));
      if (col) {
        sum[0] = (sum[0] ?? 0) + (col.getX(i + k) * a) / 3;
        sum[1] = (sum[1] ?? 0) + (col.getY(i + k) * a) / 3;
        sum[2] = (sum[2] ?? 0) + (col.getZ(i + k) * a) / 3;
      }
    }
    area += a;
  }
  const mean = area > 0 ? sum.map((v) => v / area) : [0.5, 0.5, 0.5];
  return { minX, maxX, minZ, maxZ, top, mean };
}

/** One upward quad over the piece's top in its mean colour (two triangles). */
export function flatTile(full: PieceGeometry): PieceGeometry {
  const t = topOf(full.body);
  if (!Number.isFinite(t.top)) return full;
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: y } = t;
  const position = new Float32Array([
    x0,
    y,
    z0,
    x0,
    y,
    z1,
    x1,
    y,
    z1,
    x0,
    y,
    z0,
    x1,
    y,
    z1,
    x1,
    y,
    z0,
  ]);
  const normal = new Float32Array(18);
  for (let i = 1; i < 18; i += 3) normal[i] = 1;
  const color = new Float32Array(18);
  for (let i = 0; i < 18; i += 3) color.set(t.mean, i);
  const body = new BufferGeometry();
  body.setAttribute("position", new BufferAttribute(position, 3));
  body.setAttribute("normal", new BufferAttribute(normal, 3));
  body.setAttribute("color", new BufferAttribute(color, 3));
  return { body };
}
