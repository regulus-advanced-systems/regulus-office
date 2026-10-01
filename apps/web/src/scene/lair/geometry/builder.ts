/**
 * Procedural mesh builder for the lair kit (#183). Every piece is authored
 * here in code as low-poly primitives (boxes, cylinders, cones, jittered
 * icosahedra and hand-placed triangles) baked into ONE non-indexed
 * BufferGeometry with vertex colours. One geometry per piece means one draw
 * call per piece type when it is instanced, whatever the piece's detail.
 *
 * Faceted (flat) normals by default, which the toon ramp turns into the
 * chunky hand-painted look of SPEC §12. Colours are sRGB hex strings
 * converted to linear (three's colour management), with optional per-face
 * jitter so large surfaces are not flat fills.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mulberry32 } from "../../materials/grime.ts";

export type Vec3 = readonly [number, number, number];

export interface PartOptions {
  /** Euler rotation (x, y, z), radians, applied before translation. */
  rot?: Vec3;
  /** Non-uniform scale applied before rotation. */
  scale?: Vec3;
  /** Per-triangle brightness jitter, fraction (0.1 = ±5 %). */
  jitter?: number;
  /** Keep the primitive's smooth normals (cylinders, spheres) instead of faceting. */
  smooth?: boolean;
}

/** The two layers of a piece: toon-lit body and unlit glow (bulbs, screens, lamps). */
export interface PieceGeometry {
  body: BufferGeometry;
  glow?: BufferGeometry;
}

const colorCache = new Map<string, Color>();
function linear(hex: string): Color {
  let c = colorCache.get(hex);
  if (!c) {
    c = new Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

function compose(at: Vec3, rot?: Vec3, scale?: Vec3): Matrix4 {
  const q = new Quaternion().setFromEuler(new Euler(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0));
  return new Matrix4().compose(
    new Vector3(at[0], at[1], at[2]),
    q,
    new Vector3(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1),
  );
}

export class PartBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly rand: () => number;
  /** Brightness of the triangle being written (per-face jitter). */
  private shade = 1;

  constructor(seed = 1) {
    this.rand = mulberry32(seed);
  }

  /** Seeded random in [0, 1), for callers that scatter details. */
  random(): number {
    return this.rand();
  }

  /** Bake a three primitive into the piece. Consumes (disposes) `geo`. */
  add(geo: BufferGeometry, at: Vec3, color: string, opts: PartOptions = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(compose(at, opts.rot, opts.scale));
    if (!opts.smooth) g.computeVertexNormals();
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const base = linear(color);
    const jitter = opts.jitter ?? 0;
    for (let i = 0; i < p.count; i++) {
      if (i % 3 === 0) this.shade = 1 + (this.rand() - 0.5) * jitter;
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(base.r * this.shade, base.g * this.shade, base.b * this.shade);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }

  /** Append a geometry that already has vertex colours (another builder's output), transformed. */
  append(geo: BufferGeometry, at: Vec3 = [0, 0, 0], rot?: Vec3, scale?: Vec3): this {
    const g = geo.clone();
    g.applyMatrix4(compose(at, rot, scale));
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const c = g.getAttribute("color");
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    g.dispose();
    return this;
  }

  box(size: Vec3, at: Vec3, color: string, opts?: PartOptions): this {
    return this.add(new BoxGeometry(size[0], size[1], size[2]), at, color, opts);
  }

  /** Cylinder along y (rotate with `rot` for other axes). */
  cylinder(
    rTop: number,
    rBottom: number,
    height: number,
    segments: number,
    at: Vec3,
    color: string,
    opts?: PartOptions,
  ): this {
    return this.add(
      new CylinderGeometry(rTop, rBottom, height, segments, 1, false),
      at,
      color,
      opts,
    );
  }

  cone(
    radius: number,
    height: number,
    segments: number,
    at: Vec3,
    color: string,
    opts?: PartOptions,
  ): this {
    return this.add(new ConeGeometry(radius, height, segments, 1, false), at, color, opts);
  }

  sphere(radius: number, w: number, h: number, at: Vec3, color: string, opts?: PartOptions): this {
    return this.add(new SphereGeometry(radius, w, h), at, color, opts);
  }

  /** A lumpy boulder: an icosahedron with its vertices pushed in and out (seeded). */
  boulder(
    radius: number,
    at: Vec3,
    color: string,
    opts: PartOptions & { lump?: number } = {},
  ): this {
    const geo = new IcosahedronGeometry(radius, 0);
    const p = geo.getAttribute("position");
    const lump = opts.lump ?? 0.25;
    const byKey = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      // Shared corners move together so the boulder stays closed.
      const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
      let k = byKey.get(key);
      if (k === undefined) {
        k = 1 + (this.rand() - 0.5) * 2 * lump;
        byKey.set(key, k);
      }
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    return this.add(geo, at, color, { jitter: 0.12, ...opts });
  }

  /** One flat-shaded triangle (counter-clockwise seen from the front), brightness `k`. */
  tri(a: Vec3, b: Vec3, c: Vec3, color: string, k = 1): this {
    const ab = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = ab.cross(ac).normalize();
    const c0 = linear(color);
    for (const v of [a, b, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(c0.r * k, c0.g * k, c0.b * k);
    }
    return this;
  }

  /** A quad as two triangles: corners in counter-clockwise order seen from the front. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: string, k = 1): this {
    return this.tri(a, b, c, color, k).tri(a, c, d, color, k);
  }

  /** A flat rectangle facing +z at depth `z` (decals: stripes, tie holes, labels). */
  panelZ(x0: number, y0: number, x1: number, y1: number, z: number, color: string, k = 1): this {
    return this.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], color, k);
  }

  /** A flat rectangle facing +y at height `y` (floor decals). */
  panelY(x0: number, z0: number, x1: number, z1: number, y: number, color: string, k = 1): this {
    return this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color, k);
  }

  /** A four-sided rivet head on a +z face: a low pyramid (4 triangles). */
  rivetZ(x: number, y: number, z: number, color: string, r = 0.018): this {
    const tip: Vec3 = [x, y, z + r * 0.8];
    const bl: Vec3 = [x - r, y - r, z];
    const br: Vec3 = [x + r, y - r, z];
    const tr: Vec3 = [x + r, y + r, z];
    const tl: Vec3 = [x - r, y + r, z];
    return this.tri(bl, br, tip, color)
      .tri(br, tr, tip, color)
      .tri(tr, tl, tip, color)
      .tri(tl, bl, tip, color);
  }

  /** Diagonal yellow-and-black hazard stripes on a +z face, `n` stripes across. */
  hazardZ(x0: number, y0: number, x1: number, y1: number, z: number, n: number): this {
    const w = (x1 - x0) / n;
    const s = Math.min(w, y1 - y0);
    const cl = (x: number) => Math.min(x1, Math.max(x0, x));
    const color = (i: number) => (i % 2 === 0 ? "#F2C200" : "#1C1D1F");
    this.tri([x0, y0, z], [cl(x0 + s), y1, z], [x0, y1, z], color(1));
    for (let i = 0; i < n; i++) {
      const a = x0 + i * w;
      this.quad(
        [cl(a), y0, z],
        [cl(a + w), y0, z],
        [cl(a + w + s), y1, z],
        [cl(a + s), y1, z],
        color(i),
      );
    }
    return this;
  }

  triangles(): number {
    return this.pos.length / 9;
  }

  build(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    geo.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    geo.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Triangles in a (non-indexed or indexed) geometry. */
export function triangleCount(geo: BufferGeometry): number {
  return geo.index ? geo.index.count / 3 : geo.getAttribute("position").count / 3;
}

/** Triangles in both layers of a piece. */
export function pieceTriangles(piece: PieceGeometry): number {
  return triangleCount(piece.body) + (piece.glow ? triangleCount(piece.glow) : 0);
}
