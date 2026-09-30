/**
 * Renders the ConfettiField as one InstancedMesh of small quads. Bursts come
 * in through a `bus` (the RobotLayer's, the merge gong's). Not mounted with
 * reduced motion.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  Color,
  DoubleSide,
  Euler,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { CONFETTI_CAPACITY, CONFETTI_COLORS, ConfettiField } from "./confetti.ts";

export interface ConfettiBus {
  /** Bursts to fire next frame; `count` defaults to CONFETTI_PER_BURST. */
  pending: { x: number; y: number; z: number; count?: number }[];
}

export function createConfettiBus(): ConfettiBus {
  return { pending: [] };
}

export function Confetti({ bus, name = "confetti" }: { bus: ConfettiBus; name?: string }) {
  const mesh = useRef<InstancedMesh>(null);
  const field = useMemo(() => new ConfettiField(), []);
  const geometry = useMemo(() => new PlaneGeometry(0.1, 0.06), []);
  const material = useMemo(
    () => new MeshBasicMaterial({ side: DoubleSide, toneMapped: false }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const scratch = useMemo(
    () => ({
      m: new Matrix4(),
      q: new Quaternion(),
      e: new Euler(),
      p: new Vector3(),
      s: new Vector3(1, 1, 1),
      colors: CONFETTI_COLORS.map((c) => new Color(c)),
    }),
    [],
  );

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    for (const origin of bus.pending.splice(0)) field.burst(origin, origin.count);
    field.step(Math.min(delta, 0.1));
    let n = 0;
    for (const p of field.particles) {
      if (!p.live) continue;
      scratch.q.setFromEuler(scratch.e.set(p.rx, p.ry, 0));
      scratch.m.compose(scratch.p.set(p.x, p.y, p.z), scratch.q, scratch.s);
      m.setMatrixAt(n, scratch.m);
      m.setColorAt(n, scratch.colors[p.color] as Color);
      n += 1;
    }
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      name={name}
      args={[geometry, material, CONFETTI_CAPACITY]}
      frustumCulled={false}
    />
  );
}
