/**
 * Console lamps (#183): every lamp socket of every console and mainframe in
 * the scene as ONE instanced mesh whose per-instance colours blink
 * (animation.ts `lampLevel`), updated ten times a second. Unlit, so the
 * lamps read in the dark corners of the lair.
 */
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  Color,
  InstancedBufferAttribute,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { lampLevel } from "../animation.ts";
import type { Vec3 } from "../geometry/builder.ts";
import type { LampSocket } from "../geometry/consoles.ts";
import { type PiecePlacement, placementMatrix } from "../placements.ts";

export interface WorldLamp {
  pos: Vec3;
  color: string;
}

/** World positions of the lamp sockets of every placement (sockets are piece-local). */
export function worldLamps(
  placements: readonly PiecePlacement[],
  sockets: readonly LampSocket[],
): WorldLamp[] {
  const m = new Matrix4();
  const v = new Vector3();
  const out: WorldLamp[] = [];
  for (const p of placements) {
    placementMatrix(p, m);
    for (const s of sockets) {
      v.set(s.pos[0], s.pos[1], s.pos[2]).applyMatrix4(m);
      out.push({ pos: [v.x, v.y, v.z], color: s.color });
    }
  }
  return out;
}

const UPDATE_HZ = 10;

export function BlinkingLamps({
  lamps,
  radius = 0.024,
}: {
  lamps: readonly WorldLamp[];
  radius?: number;
}) {
  const ref = useRef<InstancedMesh>(null);
  const geo = useMemo(() => new SphereGeometry(radius, 6, 4), [radius]);
  const mat = useMemo(() => new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), []);
  const base = useMemo(() => lamps.map((l) => new Color(l.color)), [lamps]);
  const last = useRef(-1);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    lamps.forEach((l, i) => mesh.setMatrixAt(i, m.makeTranslation(l.pos[0], l.pos[1], l.pos[2])));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(lamps.length * 3), 3);
    mesh.computeBoundingSphere();
    last.current = -1;
  }, [lamps]);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh?.instanceColor) return;
    const t = clock.elapsedTime;
    const tick = Math.floor(t * UPDATE_HZ);
    if (tick === last.current) return;
    last.current = tick;
    const arr = mesh.instanceColor.array as Float32Array;
    base.forEach((c, i) => {
      const k = lampLevel(i, t);
      arr[i * 3] = c.r * k;
      arr[i * 3 + 1] = c.g * k;
      arr[i * 3 + 2] = c.b * k;
    });
    mesh.instanceColor.needsUpdate = true;
  });

  useLayoutEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  if (lamps.length === 0) return null;
  return (
    <instancedMesh key={lamps.length} ref={ref} args={[geo, mat, lamps.length]} name="lair:lamps" />
  );
}
