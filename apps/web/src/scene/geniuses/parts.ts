/**
 * Low-poly part kit for procedural geniuses: boxes (optionally tapered),
 * faceted balls, few-sided cylinders and cones, each tagged with a palette
 * slot and the bone it rides on. `build()` merges everything into one
 * skinned geometry (rigid weights), so a genius is a single draw call.
 */
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Slot, slotU } from "./palette.ts";
import { type BoneName, boneIndex, type Vec3 } from "./rig.ts";

export interface PartOptions {
  /** Euler XYZ rotation in radians, applied before moving to `at`. */
  rot?: Vec3;
  /** Non-uniform scale applied before rotation. */
  scale?: Vec3;
}

export interface BoxOptions extends PartOptions {
  /** Scale of the top face (x, z) relative to the bottom: <1 narrows, >1 flares upward. */
  taper?: [number, number];
  /** Shift of the top face along x/z (leaning slabs: lapels, coat tails). */
  shear?: [number, number];
}

export class PartBuilder {
  private readonly parts: BufferGeometry[] = [];

  /** Add any geometry centred at its own origin. */
  add(geo: BufferGeometry, slot: Slot, bone: BoneName, at: Vec3, opts: PartOptions = {}): this {
    const source = geo.index ? geo.toNonIndexed() : geo;
    if (source !== geo) geo.dispose();
    for (const name of Object.keys(source.attributes)) {
      if (name !== "position" && name !== "normal") source.deleteAttribute(name);
    }
    const s = opts.scale ?? [1, 1, 1];
    const r = opts.rot ?? [0, 0, 0];
    const matrix = new Matrix4().compose(
      new Vector3(...at),
      new Quaternion().setFromEuler(new Euler(...r)),
      new Vector3(...s),
    );
    source.applyMatrix4(matrix);
    const n = source.getAttribute("position").count;
    const uv = new Float32Array(n * 2);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const u = slotU(slot);
    const b = boneIndex(bone);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = u;
      uv[i * 2 + 1] = 0.5;
      skinIndex[i * 4] = b;
      skinWeight[i * 4] = 1;
    }
    source.setAttribute("uv", new BufferAttribute(uv, 2));
    source.setAttribute("skinIndex", new BufferAttribute(skinIndex, 4));
    source.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
    this.parts.push(source);
    return this;
  }

  box(bone: BoneName, slot: Slot, size: Vec3, at: Vec3, opts: BoxOptions = {}): this {
    const geo = new BoxGeometry(...size);
    if (opts.taper || opts.shear) {
      const [tx, tz] = opts.taper ?? [1, 1];
      const [sx, sz] = opts.shear ?? [0, 0];
      const pos = geo.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) <= 0) continue;
        pos.setXYZ(i, pos.getX(i) * tx + sx, pos.getY(i), pos.getZ(i) * tz + sz);
      }
      geo.computeVertexNormals();
    }
    return this.add(geo, slot, bone, at, opts);
  }

  /** Faceted ball; `radius` may be per-axis for eggs and bellies. detail 0 = 20 faces, 1 = 80. */
  ball(
    bone: BoneName,
    slot: Slot,
    radius: number | Vec3,
    at: Vec3,
    opts: PartOptions & { detail?: number } = {},
  ): this {
    const r: Vec3 = typeof radius === "number" ? [radius, radius, radius] : radius;
    const scale: Vec3 = opts.scale
      ? [r[0] * opts.scale[0], r[1] * opts.scale[1], r[2] * opts.scale[2]]
      : r;
    return this.add(new IcosahedronGeometry(1, opts.detail ?? 0), slot, bone, at, {
      ...opts,
      scale,
    });
  }

  cyl(
    bone: BoneName,
    slot: Slot,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    at: Vec3,
    opts: PartOptions & { sides?: number; open?: boolean; thetaStart?: number } = {},
  ): this {
    const geo = new CylinderGeometry(
      radiusTop,
      radiusBottom,
      height,
      opts.sides ?? 6,
      1,
      opts.open,
      opts.thetaStart,
    );
    return this.add(geo, slot, bone, at, opts);
  }

  cone(
    bone: BoneName,
    slot: Slot,
    radius: number,
    height: number,
    at: Vec3,
    opts: PartOptions & { sides?: number } = {},
  ): this {
    return this.add(new ConeGeometry(radius, height, opts.sides ?? 6), slot, bone, at, opts);
  }

  /** Same part on both sides: `at` is the left (+x) one, mirrored to -x on `boneR`. */
  mirror(fn: (side: 1 | -1, bone: (left: BoneName, right: BoneName) => BoneName) => void): this {
    fn(1, (left) => left);
    fn(-1, (_left, right) => right);
    return this;
  }

  get count(): number {
    return this.parts.length;
  }

  /** One merged, skinned geometry (positions, normals, palette uv, rigid skin weights). */
  build(): BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error("genius parts could not be merged");
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    // Non-indexed: one normal per face, the faceted low-poly look under the toon ramp.
    merged.computeVertexNormals();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}
