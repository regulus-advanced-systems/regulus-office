/**
 * Sliding steel doors (#183): the static frames as one instanced piece and
 * every leaf of every door as one more instanced mesh (plus its glow),
 * animated with `stepOpenness` / `easeDoor` (animation.ts) toward each
 * door's `open` flag. #186 sets `open` as the player approaches a room they
 * may enter. Frames and leaves are cut away with the walls.
 */
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { type InstancedMesh, Matrix4 } from "three";
import { easeDoor, stepOpenness } from "../animation.ts";
import type { Vec3 } from "../geometry/builder.ts";
import { leafOffsets } from "../geometry/doors.ts";
import { pieceGeometry } from "../kit.ts";
import { type PiecePlacement, placementMatrix } from "../placements.ts";
import { InstancedPiece } from "./InstancedPieces.tsx";
import { useLairMaterials } from "./LairKit.tsx";

export interface DoorState {
  id: string;
  position: Vec3;
  rotationY?: number;
  open: boolean;
}

/** The two leaf placements of a door at an openness, in world space. */
export function leafPlacements(
  door: DoorState,
  openness: number,
): [PiecePlacement, PiecePlacement] {
  const { left, right } = leafOffsets(easeDoor(openness));
  const yaw = door.rotationY ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (x: number): Vec3 => [
    door.position[0] + x * c,
    door.position[1],
    door.position[2] - x * s,
  ];
  return [
    { piece: "door_leaf", position: at(left), rotationY: yaw },
    // The right leaf is the left one turned round, so its rib and pocket edge mirror.
    { piece: "door_leaf", position: at(right), rotationY: yaw + Math.PI },
  ];
}

export function SlidingDoors({ doors }: { doors: readonly DoorState[] }) {
  const mats = useLairMaterials();
  const leaf = pieceGeometry("door_leaf");
  const bodyRef = useRef<InstancedMesh>(null);
  const glowRef = useRef<InstancedMesh>(null);
  const openness = useRef(new Map<string, number>());
  const frames = useMemo<PiecePlacement[]>(
    () =>
      doors.map((d) => ({
        piece: "door_frame",
        position: d.position,
        rotationY: d.rotationY ?? 0,
      })),
    [doors],
  );
  const count = doors.length * 2;

  const write = (force: boolean, dt: number) => {
    const meshes = [bodyRef.current, glowRef.current].filter((m): m is InstancedMesh => m !== null);
    if (meshes.length === 0) return;
    const m = new Matrix4();
    let moved = force;
    doors.forEach((d, i) => {
      const before = openness.current.get(d.id) ?? (d.open ? 1 : 0);
      const now = stepOpenness(before, d.open ? 1 : 0, dt);
      openness.current.set(d.id, now);
      if (now === before && !force) return;
      moved = true;
      leafPlacements(d, now).forEach((p, k) => {
        placementMatrix(p, m);
        for (const mesh of meshes) mesh.setMatrixAt(i * 2 + k, m);
      });
    });
    if (!moved) return;
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  };

  // Rewrite every leaf when the door list changes (new doors, moved doors).
  useLayoutEffect(() => write(true, 0), [doors]);
  useFrame((_, dt) => write(false, Math.min(dt, 0.1)));

  if (doors.length === 0) return null;
  return (
    <group name="lair:doors">
      <InstancedPiece piece="door_frame" placements={frames} />
      <instancedMesh key={`b${count}`} ref={bodyRef} args={[leaf.body, mats.cutBody, count]} />
      {leaf.glow && (
        <instancedMesh key={`g${count}`} ref={glowRef} args={[leaf.glow, mats.cutGlow, count]} />
      )}
    </group>
  );
}
