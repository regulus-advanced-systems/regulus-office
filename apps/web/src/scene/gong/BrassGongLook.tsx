/**
 * What the merge gong looks like (#43), kept apart from where it hangs and
 * what it does (GongObject), like the boards' look (#36): the lair art kit
 * (M2.5) swaps it by passing another {@link GongLook}. Drawn in the anchor's
 * local space: centred on the anchor, facing +z, the wall at z = 0, filling
 * `w` x `h`, with the floor `floor` metres below the centre.
 *
 * This one is a brass disc on two cords from a dark wooden stand against the
 * wall, with a mallet leaning on one post. Low-poly and toon-shaded.
 */
import { useFrame } from "@react-three/fiber";
import { type ComponentType, type Ref, useEffect, useMemo } from "react";
import type { Group } from "three";
import { createToonMaterial } from "../materials/toon.ts";

export interface GongLookProps {
  /** Anchor size, metres. */
  w: number;
  h: number;
  /** Distance from the anchor's centre down to the floor, metres. */
  floor: number;
  /** Hovered or the player is in reach: draw a highlight. */
  highlighted: boolean;
  /**
   * Put this on the group that swings, with its origin at the hanging point;
   * GongObject turns it about x as the disc swings.
   */
  swingRef: Ref<Group>;
  /** 0..1 strike glow, updated every frame (read it in `useFrame`; no re-render). */
  glow: { value: number };
}

export type GongLook = ComponentType<GongLookProps>;

const WOOD = "#3E2A1C";
const BRASS = "#C9A227";
const BOSS = "#9C7A18";
const CORD = "#7A1F1A";
const HIGHLIGHT = "#F5C542";
/** How far in front of the wall the frame stands, metres. */
export const GONG_DEPTH = 0.16;

/** Disc radius and hanging point for an anchor of `w` x `h`. */
export function gongGeometry(w: number, h: number) {
  const post = 0.05;
  const r = Math.min((w - 2 * post) * 0.46, h * 0.3);
  const top = h / 2 - 0.05;
  const cord = Math.max(0.06, h * 0.08);
  return { post, r, top, cord, discY: -(cord + r) };
}

export function BrassGongLook({ w, h, floor, highlighted, swingRef, glow }: GongLookProps) {
  const g = gongGeometry(w, h);
  const wood = useMemo(() => createToonMaterial(WOOD), []);
  const cord = useMemo(() => createToonMaterial(CORD), []);
  const boss = useMemo(() => createToonMaterial(BOSS), []);
  const halo = useMemo(() => createToonMaterial(HIGHLIGHT), []);
  // The disc's own material: its glow changes every frame.
  const brass = useMemo(() => {
    const m = createToonMaterial(BRASS);
    m.emissive.set(HIGHLIGHT);
    m.emissiveIntensity = 0;
    return m;
  }, []);
  useEffect(
    () => () => {
      for (const m of [wood, cord, boss, halo, brass]) m.dispose();
    },
    [wood, cord, boss, halo, brass],
  );
  useFrame(() => {
    brass.emissiveIntensity = 0.6 * glow.value;
  });

  const z = GONG_DEPTH;
  const postX = w / 2 - g.post / 2;
  return (
    <group>
      {/* Stand: two posts from the floor, a crossbar, brackets back to the wall. */}
      {[-postX, postX].map((x) => (
        <group key={x}>
          <mesh position={[x, (h / 2 - floor) / 2, z]} material={wood}>
            <boxGeometry args={[g.post, h / 2 + floor, g.post]} />
          </mesh>
          <mesh position={[x, g.top, z / 2]} material={wood}>
            <boxGeometry args={[0.03, 0.03, z]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, g.top, z]} material={wood}>
        <boxGeometry args={[w + 0.06, 0.07, 0.07]} />
      </mesh>
      {/* The swinging part: cords and disc, pivoting under the crossbar. */}
      <group position={[0, g.top - 0.035, z]} ref={swingRef}>
        {[-0.45, 0.45].map((k) => (
          <mesh key={k} position={[k * g.r, -g.cord / 2, 0]} material={cord}>
            <boxGeometry args={[0.012, g.cord + 0.04, 0.012]} />
          </mesh>
        ))}
        {highlighted && (
          <mesh position={[0, g.discY, -0.02]} rotation-x={Math.PI / 2} material={halo}>
            <cylinderGeometry args={[g.r + 0.035, g.r + 0.035, 0.01, 28]} />
          </mesh>
        )}
        <mesh position={[0, g.discY, 0]} rotation-x={Math.PI / 2} material={brass}>
          <cylinderGeometry args={[g.r, g.r * 0.96, 0.025, 28]} />
        </mesh>
        <mesh position={[0, g.discY, 0.018]} rotation-x={Math.PI / 2} material={boss}>
          <cylinderGeometry args={[g.r * 0.3, g.r * 0.34, 0.02, 20]} />
        </mesh>
      </group>
      {/* A mallet leaning on the right post. */}
      <group position={[postX - 0.02, -floor, z + 0.1]} rotation-z={0.22}>
        <mesh position={[0, 0.2, 0]} material={wood}>
          <cylinderGeometry args={[0.012, 0.012, 0.4, 6]} />
        </mesh>
        <mesh position={[0, 0.42, 0]} material={cord}>
          <sphereGeometry args={[0.045, 10, 8]} />
        </mesh>
      </group>
    </group>
  );
}
