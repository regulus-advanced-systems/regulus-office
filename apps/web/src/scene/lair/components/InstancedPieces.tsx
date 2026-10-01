/**
 * Instanced rendering for the lair kit (#183): `<PieceSet>` draws any number
 * of placements with ONE InstancedMesh per piece type (two when the piece
 * has a glow layer), whatever the pieces' detail; see budget.ts for the
 * draw-call budget this buys. Walls and wall-mounted pieces get the
 * cutaway materials automatically.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { InstancedBufferAttribute, type InstancedMesh, Matrix4 } from "three";
import { drawnGeometry, type PieceId } from "../kit.ts";
import {
  groupByPiece,
  instanceTints,
  isCutaway,
  type PiecePlacement,
  placementMatrix,
} from "../placements.ts";
import { useLairMaterials } from "./LairKit.tsx";

function useInstances(
  ref: React.RefObject<InstancedMesh | null>,
  placements: readonly PiecePlacement[],
  tint: boolean,
) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    placements.forEach((p, i) => {
      mesh.setMatrixAt(i, placementMatrix(p, m));
    });
    mesh.instanceMatrix.needsUpdate = true;
    const tints = tint ? instanceTints(placements) : null;
    mesh.instanceColor = tints ? new InstancedBufferAttribute(tints, 3) : null;
    // Bounds over all instances, or the mesh is culled by the geometry's own bounds.
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [ref, placements, tint]);
}

export interface InstancedPieceProps {
  piece: PieceId;
  placements: readonly PiecePlacement[];
  /** Override the cutaway choice from the registry. */
  cutaway?: boolean;
  /** Draw the glow layer (off when a component animates it itself). */
  glow?: boolean;
  name?: string;
  /** Low tier: floors as flat stand-ins (lite.ts). */
  lite?: boolean;
}

export function InstancedPiece({
  piece,
  placements,
  cutaway,
  glow = true,
  name,
  lite = false,
}: InstancedPieceProps) {
  const mats = useLairMaterials();
  const geo = drawnGeometry(piece, lite);
  const cut = cutaway ?? isCutaway(piece);
  const bodyRef = useRef<InstancedMesh>(null);
  const glowRef = useRef<InstancedMesh>(null);
  useInstances(bodyRef, placements, true);
  useInstances(glowRef, placements, false);
  const count = placements.length;
  if (count === 0) return null;
  return (
    <group name={name ?? `lair:${piece}`}>
      <instancedMesh
        key={`b${count}${lite ? "l" : ""}`}
        ref={bodyRef}
        args={[geo.body, cut ? mats.cutBody : mats.body, count]}
        raycast={() => null}
      />
      {glow && geo.glow && (
        <instancedMesh
          key={`g${count}`}
          ref={glowRef}
          args={[geo.glow, cut ? mats.cutGlow : mats.glow, count]}
          raycast={() => null}
        />
      )}
    </group>
  );
}

/** Any mix of placements: one instanced draw (or two, with glow) per piece type. */
export function PieceSet({
  items,
  lite = false,
}: {
  items: readonly PiecePlacement[];
  /** Low tier: floors as flat stand-ins (lite.ts). */
  lite?: boolean;
}) {
  const groups = useMemo(() => [...groupByPiece(items)], [items]);
  return (
    <>
      {groups.map(([piece, placements]) => (
        <InstancedPiece key={piece} piece={piece} placements={placements} lite={lite} />
      ))}
    </>
  );
}
