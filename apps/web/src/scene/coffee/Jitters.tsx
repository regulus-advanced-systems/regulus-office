/**
 * The jitters (#63): wraps a human's drawn body and, from their third cup,
 * shakes it a little (buzz.ts `jitterOffset`). Only the body is moved: the
 * group that carries the human's pose, the player store and the camera stay
 * where they are, so no view ever shakes. With reduced motion the body
 * stands still and the badge over the head says "Jitters" instead
 * (BuzzBadge.tsx). Named `jitters` (userData.shaking) for the e2e probes.
 */
import { useFrame } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { useBuildingStore } from "../../state/building.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { jitterOffset, jitterSeed, shakes } from "./buzz.ts";

/** Cups in the buzz of the human of `sessionId`, as published to this viewer. */
export function useCups(sessionId: string | null | undefined): number {
  return useBuildingStore((s) => (sessionId ? (s.state?.humans[sessionId]?.cups ?? 0) : 0));
}

export function Jitters({
  sessionId,
  children,
}: {
  sessionId: string | null | undefined;
  children: ReactNode;
}) {
  const group = useRef<Group>(null);
  const cups = useCups(sessionId);
  const reducedMotion = useUiStore(selectReducedMotion);
  const shaking = shakes(cups, reducedMotion);
  const seed = useMemo(() => jitterSeed(sessionId ?? ""), [sessionId]);

  // The moment the shaking stops the body is back where it stands.
  useEffect(() => {
    const g = group.current;
    if (!shaking && g) {
      g.position.set(0, 0, 0);
      g.rotation.y = 0;
    }
  }, [shaking]);

  useFrame((state) => {
    const g = group.current;
    if (!g || !shaking) return;
    const o = jitterOffset(state.clock.elapsedTime, seed);
    g.position.set(o.x, 0, o.z);
    g.rotation.y = o.yaw;
  });

  return (
    <group ref={group} name="jitters" userData={{ shaking, cups }}>
      {children}
    </group>
  );
}
