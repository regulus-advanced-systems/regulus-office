/**
 * Lair restyles of the swappable looks (#36 boards, #37 queue clipboard,
 * #43 gong): pass one as `look` to BoardObject / QueueClipboard /
 * GongObject. They only change how the object is drawn, never what it does,
 * and take the same props as the defaults (drawn in the anchor's local
 * space, facing +z, the wall at z = 0).
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { BoardLookProps } from "../../boards/CorkBoardLook.tsx";
import { GONG_DEPTH, type GongLookProps, gongGeometry } from "../../gong/BrassGongLook.tsx";
import { createToonMaterial } from "../../materials/toon.ts";
import type { ClipboardLookProps } from "../../queue/ClipboardLook.tsx";
import { LAIR } from "../palette.ts";

function useToon(colors: readonly string[]) {
  const mats = useMemo(() => colors.map((c) => createToonMaterial(c)), [colors]);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  return mats;
}

const BOARD_COLORS = [LAIR.steelDark, LAIR.yellow, LAIR.steelLight, LAIR.red] as const;

/** A board in a riveted steel frame with a yellow lip and a red status lamp. */
export function LairBoardLook({ w, h, texture, highlighted }: BoardLookProps) {
  const [frame, lip, rivet, lamp] = useToon(BOARD_COLORS);
  const border = 0.08;
  return (
    <group>
      {highlighted && (
        <mesh position={[0, 0, 0.005]} material={lip}>
          <boxGeometry args={[w + border * 2 + 0.1, h + border * 2 + 0.1, 0.01]} />
        </mesh>
      )}
      <mesh position={[0, 0, 0.03]} material={frame}>
        <boxGeometry args={[w + border * 2, h + border * 2, 0.06]} />
      </mesh>
      <mesh position={[0, -h / 2 - border + 0.015, 0.065]} material={lip}>
        <boxGeometry args={[w + border * 2, 0.03, 0.02]} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sy) => (
          <mesh
            key={`${sx}${sy}`}
            position={[sx * (w / 2 + border / 2), sy * (h / 2 + border / 2), 0.065]}
            material={rivet}
          >
            <sphereGeometry args={[0.018, 6, 4]} />
          </mesh>
        )),
      )}
      <mesh position={[w / 2 + border / 2, h / 2 + border + 0.04, 0.04]} material={lamp}>
        <sphereGeometry args={[0.035, 8, 6]} />
      </mesh>
      <mesh position={[0, 0, 0.061]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial
          map={texture}
          color={texture ? "#FFFFFF" : LAIR.steelPaint}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

const CLIP_COLORS = [LAIR.steelPaint, LAIR.chrome, LAIR.yellow, LAIR.steelDark] as const;

/** A steel clipboard hanging from a wall hook, with a yellow-tabbed clip. */
export function LairClipboardLook({ w, h, texture, highlighted }: ClipboardLookProps) {
  const [board, clip, tab, hook] = useToon(CLIP_COLORS);
  const margin = 0.04;
  return (
    <group>
      {highlighted && (
        <mesh position={[0, 0, 0.004]} material={tab}>
          <boxGeometry args={[w + 0.08, h + 0.08, 0.008]} />
        </mesh>
      )}
      <mesh position={[0, h / 2 + 0.05, 0.02]} material={hook}>
        <boxGeometry args={[0.04, 0.06, 0.04]} />
      </mesh>
      <mesh position={[0, 0, 0.014]} material={board}>
        <boxGeometry args={[w, h, 0.02]} />
      </mesh>
      <mesh position={[0, -margin / 2, 0.025]}>
        <planeGeometry args={[w - margin * 2, h - margin * 3]} />
        <meshBasicMaterial
          map={texture}
          color={texture ? "#FFFFFF" : LAIR.cream}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, h / 2 - margin * 0.8, 0.035]} material={clip}>
        <boxGeometry args={[w * 0.45, margin * 1.4, 0.022]} />
      </mesh>
      <mesh position={[0, h / 2 - margin * 0.2, 0.048]} material={tab}>
        <boxGeometry args={[w * 0.2, margin * 0.6, 0.01]} />
      </mesh>
    </group>
  );
}

const GONG_COLORS = [LAIR.steelDark, LAIR.red, LAIR.brass, LAIR.yellow, "#9C7A18"] as const;

/** The merge gong in a riveted steel gantry with hazard-red chains (same swing and glow hooks). */
export function LairGongLook({ w, h, floor, highlighted, swingRef, glow }: GongLookProps) {
  const g = gongGeometry(w, h);
  const [steel, chain, , halo, boss] = useToon(GONG_COLORS);
  const brass = useMemo(() => {
    const m = createToonMaterial(LAIR.brass);
    m.emissive.set(LAIR.yellow);
    m.emissiveIntensity = 0;
    return m;
  }, []);
  useEffect(() => () => brass.dispose(), [brass]);
  useFrame(() => {
    brass.emissiveIntensity = 0.6 * glow.value;
  });
  const z = GONG_DEPTH;
  const postX = w / 2 - g.post / 2;
  return (
    <group>
      {[-postX, postX].map((x) => (
        <group key={x}>
          <mesh position={[x, (h / 2 - floor) / 2, z]} material={steel}>
            <boxGeometry args={[g.post + 0.02, h / 2 + floor, g.post + 0.02]} />
          </mesh>
          <mesh position={[x, -floor + 0.03, z]} material={steel}>
            <boxGeometry args={[0.2, 0.06, 0.24]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, g.top, z]} material={steel}>
        <boxGeometry args={[w + 0.1, 0.09, 0.09]} />
      </mesh>
      <group position={[0, g.top - 0.045, z]} ref={swingRef}>
        {[-0.45, 0.45].map((k) => (
          <mesh key={k} position={[k * g.r, -g.cord / 2, 0]} material={chain}>
            <boxGeometry args={[0.018, g.cord + 0.04, 0.018]} />
          </mesh>
        ))}
        {highlighted && (
          <mesh position={[0, g.discY, -0.02]} rotation-x={Math.PI / 2} material={halo}>
            <cylinderGeometry args={[g.r + 0.035, g.r + 0.035, 0.01, 28]} />
          </mesh>
        )}
        <mesh position={[0, g.discY, 0]} rotation-x={Math.PI / 2} material={brass}>
          <cylinderGeometry args={[g.r, g.r * 0.96, 0.03, 28]} />
        </mesh>
        <mesh position={[0, g.discY, 0.02]} rotation-x={Math.PI / 2} material={boss}>
          <cylinderGeometry args={[g.r * 0.3, g.r * 0.34, 0.02, 20]} />
        </mesh>
      </group>
    </group>
  );
}
