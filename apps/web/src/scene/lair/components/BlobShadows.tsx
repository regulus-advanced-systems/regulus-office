/**
 * Soft contact shadows for lair furniture (#183; SPEC §12 "soft
 * contact/blob shadows", no shadow maps): one instanced, flat, soft-edged
 * dark quad under every floor-standing prop, sized from the piece's bounds.
 * One draw call for all of them.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  DataTexture,
  type InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
} from "three";
import { PIECES, pieceSize } from "../kit.ts";
import { softDotPixels } from "../particles/sim.ts";
import { type PiecePlacement, placementMatrix } from "../placements.ts";

/** How much bigger than the footprint a shadow is (the soft edge fades inside it). */
export const SHADOW_GROW = 1.35;
const CASTS = new Set(["furniture", "clutter", "construction"]);

/** Shadow quads for the floor-standing props among `items` (pure). */
export function blobShadowPlacements(items: readonly PiecePlacement[]): PiecePlacement[] {
  const out: PiecePlacement[] = [];
  for (const p of items) {
    if (!CASTS.has(PIECES[p.piece].category) || p.position[1] > 0.05) continue;
    const size = pieceSize(p.piece);
    const sx = (p.scale?.[0] ?? 1) * size.w * SHADOW_GROW;
    const sz = (p.scale?.[2] ?? 1) * size.d * SHADOW_GROW;
    out.push({
      piece: p.piece,
      position: [p.position[0], 0.006, p.position[2]],
      rotationY: p.rotationY,
      scale: [sx, 1, sz],
    });
  }
  return out;
}

export function BlobShadows({
  items,
  opacity = 0.5,
}: {
  items: readonly PiecePlacement[];
  opacity?: number;
}) {
  const shadows = useMemo(() => blobShadowPlacements(items), [items]);
  const ref = useRef<InstancedMesh>(null);
  const geo = useMemo(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const mat = useMemo(() => {
    const tex = new DataTexture(softDotPixels(32), 32, 32, RGBAFormat);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.needsUpdate = true;
    // White RGB with the falloff in alpha: as `map` on black it only contributes the alpha.
    return new MeshBasicMaterial({
      color: 0x000000,
      map: tex,
      transparent: true,
      opacity,
      depthWrite: false,
    });
  }, [opacity]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.map?.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    shadows.forEach((s, i) => mesh.setMatrixAt(i, placementMatrix(s, m)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shadows]);
  if (shadows.length === 0) return null;
  return (
    <instancedMesh
      key={shadows.length}
      ref={ref}
      args={[geo, mat, shadows.length]}
      renderOrder={-1}
      name="lair:shadows"
    />
  );
}
