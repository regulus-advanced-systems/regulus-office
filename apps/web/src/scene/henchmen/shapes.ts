/**
 * Low-poly building blocks for the henchman (#184): primitives placed in
 * model space (bind pose), each tagged with a palette slot and the bone(s)
 * that move it, then merged into one skinned geometry (`mergeParts`).
 *
 * Skin weights are rigid (one bone) unless a part `blend`s into a second
 * bone across a band (elbows, knees, the torso), which keeps the joints
 * closed when they bend.
 */
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Slot, slotU } from "./palette.ts";
import { BONE_INDEX, type BoneName } from "./rig.ts";

export type V3 = readonly [number, number, number];

/** Weight towards `to` grows from 0 to 1 along `axis` across `width` metres centred on `at`. */
export interface Blend {
  to: BoneName;
  at: V3;
  axis: V3;
  width: number;
}

export interface Part {
  geometry: BufferGeometry;
  slot: Slot;
  bone: BoneName;
  blend?: readonly Blend[];
}

export interface Placement {
  at?: V3;
  /** Euler angles, radians (XYZ). */
  rot?: V3;
  scale?: V3;
}

/** Move a primitive (authored at the origin) into place. */
export function place(geometry: BufferGeometry, p: Placement = {}): BufferGeometry {
  const m = new Matrix4().compose(
    new Vector3(...(p.at ?? [0, 0, 0])),
    new Quaternion().setFromEuler(new Euler(...(p.rot ?? [0, 0, 0]))),
    new Vector3(...(p.scale ?? [1, 1, 1])),
  );
  geometry.applyMatrix4(m);
  return geometry;
}

export const ellipsoid = (r: V3, p: Placement = {}, segments: [number, number] = [9, 6]) =>
  place(new SphereGeometry(1, segments[0], segments[1]).scale(r[0], r[1], r[2]), p);

/** Upper half of an ellipsoid (a dome), base at y=0. */
export const dome = (r: V3, p: Placement = {}, segments = 16) =>
  place(
    new SphereGeometry(
      1,
      segments,
      Math.max(3, segments / 3),
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    ).scale(r[0], r[1], r[2]),
    p,
  );

/** A box; rounded (more triangles) only when `radius` is given. */
export const box = (size: V3, p: Placement = {}, radius = 0) =>
  place(
    radius > 0
      ? new RoundedBoxGeometry(
          size[0],
          size[1],
          size[2],
          1,
          Math.min(radius, ...size.map((s) => s / 2.01)),
        )
      : new BoxGeometry(size[0], size[1], size[2]),
    p,
  );

export const cylinder = (
  rTop: number,
  rBottom: number,
  height: number,
  p: Placement = {},
  segments = 12,
  open = false,
) => place(new CylinderGeometry(rTop, rBottom, height, segments, 1, open), p);

/** A torus arc (from +x towards +y), tube radius `tube`. */
export const torus = (r: number, tube: number, arc: number, p: Placement = {}, segments = 14) =>
  place(new TorusGeometry(r, tube, 6, segments, arc), p);

/** A capsule from `a` to `b` (its axis), radius `r`. */
export function capsule(a: V3, b: V3, r: number, segments = 8): BufferGeometry {
  const from = new Vector3(...a);
  const to = new Vector3(...b);
  const axis = to.clone().sub(from);
  const g = new CapsuleGeometry(r, Math.max(0.001, axis.length()), 2, segments);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.clone().normalize());
  g.applyQuaternion(q);
  const mid = from.add(to).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** A body of revolution around y from (radius, height) points, squashed in z by `depth`. */
export function lathe(
  profile: ReadonlyArray<readonly [number, number]>,
  depth = 1,
  p: Placement = {},
  segments = 16,
): BufferGeometry {
  const g = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );
  g.scale(1, 1, depth);
  return place(g, p);
}

/** A part on one bone, optionally blending into others. */
export function part(
  geometry: BufferGeometry,
  slot: Slot,
  bone: BoneName,
  blend?: readonly Blend[],
): Part {
  return { geometry, slot, bone, ...(blend ? { blend } : {}) };
}

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** Bone indices and weights of one vertex of a part. */
export function weightsAt(p: Part, v: Vector3): Array<[number, number]> {
  const out: Array<[number, number]> = [[BONE_INDEX[p.bone], 1]];
  for (const b of p.blend ?? []) {
    const d = v
      .clone()
      .sub(new Vector3(...b.at))
      .dot(new Vector3(...b.axis).normalize());
    const w = smooth(d / b.width + 0.5);
    if (w <= 0) continue;
    for (const entry of out) entry[1] *= 1 - w;
    out.push([BONE_INDEX[b.to], w]);
  }
  return out.filter(([, w]) => w > 1e-4).slice(0, 4);
}

/**
 * Merge parts into one indexed geometry with `position`, `normal`, `uv`
 * (palette slot), `skinIndex` and `skinWeight`.
 */
export function mergeParts(parts: readonly Part[]): BufferGeometry {
  const prepared = parts.map((p) => {
    const g = p.geometry.index ? p.geometry : p.geometry.clone();
    if (!g.index) {
      const n = g.attributes.position?.count ?? 0;
      g.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    for (const name of Object.keys(g.attributes))
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position as BufferAttribute;
    const n = pos.count;
    const uv = new Float32Array(n * 2);
    const index = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    const u = slotU(p.slot);
    const v = new Vector3();
    for (let i = 0; i < n; i++) {
      uv[i * 2] = u;
      uv[i * 2 + 1] = 0.5;
      const ws = weightsAt(p, v.fromBufferAttribute(pos, i));
      const total = ws.reduce((s, [, w]) => s + w, 0) || 1;
      ws.forEach(([bone, w], k) => {
        index[i * 4 + k] = bone;
        weight[i * 4 + k] = w / total;
      });
    }
    g.setAttribute("uv", new BufferAttribute(uv, 2));
    g.setAttribute("skinIndex", new BufferAttribute(index, 4));
    g.setAttribute("skinWeight", new BufferAttribute(weight, 4));
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error("henchman parts do not merge");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Triangles in a geometry (indexed or not). */
export function triangleCount(g: BufferGeometry): number {
  return (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
}
