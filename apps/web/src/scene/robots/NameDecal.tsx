/** A robot's floor name label (SPEC §9.3): owner + model on the floor behind the chair. */
import type { Seat } from "@regulus/room-layout";
import { useMemo } from "react";
import { DECAL_OPACITY, DECAL_WORLD_HEIGHT, nameDecalTexture } from "./nameDecal.ts";
import { decalPlacement } from "./seatPlacement.ts";

/** Longest a decal may run along the floor, metres. */
const MAX_WORLD_WIDTH = 2.2;

export function NameDecal({
  seat,
  ownerName,
  model,
}: {
  seat: Seat;
  ownerName: string;
  model: string;
}) {
  const decal = useMemo(() => nameDecalTexture(ownerName, model), [ownerName, model]);
  const place = useMemo(() => decalPlacement(seat), [seat]);
  if (!decal) return null;
  const width = Math.min(MAX_WORLD_WIDTH, decal.aspect * DECAL_WORLD_HEIGHT);
  const height = (width / decal.aspect) * 1;
  return (
    <group position={place.position} rotation-y={place.rotationY}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={1}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          map={decal.texture}
          transparent
          opacity={DECAL_OPACITY}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
