/**
 * Culling for the compound (#186, SPEC §11): which rooms and corridor
 * chunks the camera can see, re-evaluated a few times a second (not every
 * frame) and published only when the set changes, so the instanced piece
 * lists are rebuilt rarely. Hidden rooms draw nothing at all.
 */
import { Box3, Frustum, Matrix4, Vector3 } from "three";
import { create } from "zustand";
import type { Bounds } from "./placed.ts";

/** Tallest thing in a room or corridor (walls 3 m, beacons, pendants), metres. */
const HEIGHT = 3.6;

export interface Visible {
  rooms: ReadonlySet<string>;
  chunks: ReadonlySet<string>;
  /** The camera is far out (the overview): small fixtures are left out, they would be specks. */
  far: boolean;
}

/** Camera distance beyond which the scene draws with less detail, metres (with hysteresis). */
export const FAR_DISTANCE = 60;

export interface VisibleStore extends Visible {
  set: (v: Visible) => void;
}

export const useVisibleStore = create<VisibleStore>()((set) => ({
  rooms: new Set(),
  chunks: new Set(),
  far: false,
  set: (v) => set(v),
}));

const box = new Box3();
const lo = new Vector3();
const hi = new Vector3();

export function frustumOf(camera: {
  projectionMatrix: Matrix4;
  matrixWorldInverse: Matrix4;
}): Frustum {
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

export function boundsVisible(frustum: Frustum, b: Bounds): boolean {
  box.set(lo.set(b.minX, -0.1, b.minZ), hi.set(b.maxX, HEIGHT, b.maxZ));
  return frustum.intersectsBox(box);
}

/** Ids whose bounds the frustum touches. */
export function visibleIds(
  frustum: Frustum,
  items: ReadonlyArray<{ id: string; bounds: Bounds }>,
): Set<string> {
  const out = new Set<string>();
  for (const it of items) if (boundsVisible(frustum, it.bounds)) out.add(it.id);
  return out;
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
