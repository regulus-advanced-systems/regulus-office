/**
 * Floor blobs under every obstacle and chair in the template. `BlobShadow`
 * is exported on its own so avatars can carry one.
 */
import type { RoomTemplate, Rect } from "@regulus/room-layout";
import { useMemo } from "react";
import { MeshBasicMaterial } from "three";
import { chairForSeat } from "../furniture/catalog.ts";
import { visualFootprint } from "../furniture/placement.ts";
import { seatModel } from "../furniture/sitAnchor.ts";
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

export function BlobShadows({ template }: { template: RoomTemplate }) {
  const rects = useMemo(() => {
    const out: Array<{ id: string; rect: Rect }> = [];
    for (const o of template.obstacles)
      out.push({ id: o.id, rect: visualFootprint(o, template.seats) });
    for (const s of template.seats) {
      // The chair's own footprint (it may be pulled out from its table, #163).
      const chair = chairForSeat(s.kind) && seatModel(template, s);
      if (chair) out.push({ id: `seat-${s.id}`, rect: chair.rect });
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
