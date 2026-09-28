/**
 * Floor blobs under every obstacle and chair in the template. `BlobShadow`
 * is exported on its own so avatars can carry one.
 */
import type { FloorTemplate, Rect } from "@regulus/floor-layout";
import { useMemo } from "react";
import { MeshBasicMaterial } from "three";
import { chairForSeat } from "../furniture/catalog.ts";
import { SEAT_FOOTPRINT, visualFootprint } from "../furniture/placement.ts";
import { BLOB_COLOR, BLOB_OPACITY, blobPlacement, sharedBlobTexture } from "./blob.ts";

let sharedMaterial: MeshBasicMaterial | null = null;
function blobMaterial(): MeshBasicMaterial {
  sharedMaterial ??= new MeshBasicMaterial({
    map: sharedBlobTexture(),
    color: BLOB_COLOR,
    transparent: true,
    opacity: BLOB_OPACITY,
    depthWrite: false,
  });
  return sharedMaterial;
}

export function BlobShadow({ rect }: { rect: Rect }) {
  const p = blobPlacement(rect);
  return (
    <mesh position={p.position} rotation-x={-Math.PI / 2} material={blobMaterial()}>
      <planeGeometry args={[p.width, p.depth]} />
    </mesh>
  );
}

export function BlobShadows({ template }: { template: FloorTemplate }) {
  const rects = useMemo(() => {
    const out: Array<{ id: string; rect: Rect }> = [];
    for (const o of template.obstacles)
      out.push({ id: o.id, rect: visualFootprint(o, template.seats) });
    for (const s of template.seats) {
      if (!chairForSeat(s.kind)) continue;
      const half = SEAT_FOOTPRINT / 2;
      out.push({
        id: `seat-${s.id}`,
        rect: { x: s.pose.x - half, z: s.pose.z - half, w: SEAT_FOOTPRINT, d: SEAT_FOOTPRINT },
      });
    }
    return out;
  }, [template]);
  return (
    <group name="blob-shadows">
      {rects.map(({ id, rect }) => (
        <BlobShadow key={id} rect={rect} />
      ))}
    </group>
  );
}
