/**
 * Red alarm beacons (#183): bases as one instanced piece, domes as one
 * instanced glow mesh whose colour sweeps (animation.ts `beaconLevel`) while
 * `active`, and a fixed number of red point lights on the nearest beacons
 * so the sweep washes the rock. Idle beacons glow a dull red. #188's blast
 * door alarm and the build phase switch them on.
 */
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  Color,
  InstancedBufferAttribute,
  type InstancedMesh,
  Matrix4,
  type PointLight,
} from "three";
import { beaconLevel } from "../animation.ts";
import { pieceGeometry } from "../kit.ts";
import { LAIR } from "../palette.ts";
import { type PiecePlacement, placementMatrix } from "../placements.ts";
import { InstancedPiece } from "./InstancedPieces.tsx";
import { useLairMaterials } from "./LairKit.tsx";

const RED = new Color(LAIR.red);
const IDLE = 0.35;

export interface BeaconsProps {
  items: readonly Omit<PiecePlacement, "piece">[];
  active: boolean;
  /** Red point lights on the first `lights` beacons (keep the count fixed; lights recompile shaders). */
  lights?: number;
}

export function Beacons({ items, active, lights = 2 }: BeaconsProps) {
  const mats = useLairMaterials();
  const dome = pieceGeometry("beacon").glow;
  const ref = useRef<InstancedMesh>(null);
  const lightRefs = useRef<(PointLight | null)[]>([]);
  const placements = useMemo<PiecePlacement[]>(
    () => items.map((i) => ({ ...i, piece: "beacon" })),
    [items],
  );
  const lit = Math.min(lights, placements.length);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    placements.forEach((p, i) => mesh.setMatrixAt(i, placementMatrix(p, m)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(placements.length * 3).fill(IDLE),
      3,
    );
    mesh.computeBoundingSphere();
  }, [placements]);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh?.instanceColor) return;
    const arr = mesh.instanceColor.array as Float32Array;
    placements.forEach((_, i) => {
      const k = active ? beaconLevel(clock.elapsedTime, i * 0.37) : IDLE;
      // The dome's vertex colour is already red: the instance colour is its brightness.
      arr[i * 3] = k;
      arr[i * 3 + 1] = k;
      arr[i * 3 + 2] = k;
      const light = lightRefs.current[i];
      if (light) light.intensity = active ? 6 * beaconLevel(clock.elapsedTime, i * 0.37) : 0;
    });
    mesh.instanceColor.needsUpdate = true;
  });

  if (placements.length === 0 || !dome) return null;
  return (
    <group name="lair:beacons">
      <InstancedPiece piece="beacon" placements={placements} glow={false} />
      {/* The dome: the piece's glow layer with an animated colour per beacon. */}
      <instancedMesh
        key={placements.length}
        ref={ref}
        args={[dome, mats.cutGlow, placements.length]}
        raycast={() => null}
      />
      {placements.slice(0, lit).map((p, i) => (
        <pointLight
          key={`${p.position.join(",")}`}
          ref={(l) => {
            lightRefs.current[i] = l;
          }}
          position={[p.position[0], p.position[1] + 0.2, p.position[2]]}
          color={RED}
          intensity={0}
          distance={7}
          decay={1.6}
        />
      ))}
    </group>
  );
}
