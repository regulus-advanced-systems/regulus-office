/**
 * Pooled tungsten lights (#183, SPEC §12: "a few pooled point lights per
 * visible room"): a FIXED number of warm point lights that hop to the lamps
 * nearest the focus twice a second (animation.ts `poolLights`). The count
 * never changes, because adding or removing lights recompiles every lit
 * shader. Lamps without a light still glow (their bulbs are unlit).
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type PointLight, Vector3 } from "three";
import { poolLights } from "../animation.ts";
import type { XYZ } from "../cutaway.ts";
import { LAMP_LIGHT_OFFSET } from "../geometry/fixtures.ts";
import { LAIR } from "../palette.ts";
import { type PiecePlacement, placementMatrix } from "../placements.ts";

const OFFSETS: Partial<Record<string, readonly [number, number, number]>> = {
  ...LAMP_LIGHT_OFFSET,
  arc_lamp: [0.88, 1.2, 0],
  work_light: [0, 1.4, 0.8],
};

/** Where each lamp placement's light would go, world space. */
export function lampLightPositions(lamps: readonly PiecePlacement[]): Vector3[] {
  return lamps.map((p) => {
    const off = OFFSETS[p.piece] ?? [0, 1, 0];
    return new Vector3(off[0], off[1], off[2]).applyMatrix4(placementMatrix(p));
  });
}

export interface LampLightsProps {
  lamps: readonly PiecePlacement[];
  focus: XYZ | (() => XYZ);
  /** How many real lights (fixed for the scene's life). */
  count?: number;
  intensity?: number;
  distance?: number;
}

export function LampLights({
  lamps,
  focus,
  count = 6,
  intensity = 5,
  distance = 7,
}: LampLightsProps) {
  const positions = useMemo(() => lampLightPositions(lamps), [lamps]);
  const refs = useRef<(PointLight | null)[]>([]);
  const next = useRef(0);
  useFrame(({ clock }) => {
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 0.5;
    const f = typeof focus === "function" ? focus() : focus;
    const chosen = poolLights(positions, f, count);
    refs.current.forEach((light, i) => {
      if (!light) return;
      const at = chosen[i] !== undefined ? positions[chosen[i] ?? 0] : undefined;
      if (at) {
        light.position.copy(at);
        light.intensity = intensity;
      } else {
        light.intensity = 0;
      }
    });
  });
  return (
    <group name="lair:lamp-lights">
      {Array.from({ length: count }, (_, i) => (
        <pointLight
          // Index keys: the pool has a fixed size and order.
          key={i}
          ref={(l) => {
            refs.current[i] = l;
          }}
          color={LAIR.tungsten}
          intensity={0}
          distance={distance}
          decay={1.4}
        />
      ))}
    </group>
  );
}
