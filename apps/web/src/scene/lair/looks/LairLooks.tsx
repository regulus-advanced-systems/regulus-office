/**
 * Lair restyles of the swappable looks (#36 boards, #37 queue clipboard,
 * #43 gong): pass one as `look` to BoardObject / QueueClipboard /
 * GongObject. They only change how the object is drawn, never what it does,
 * and take the same props as the defaults (drawn in the anchor's local
 * space, facing +z, the wall at z = 0).
 *
 * The static parts of each look are baked into one vertex-coloured mesh
 * (lair geometry builder) sharing one toon material, so a board costs two
 * draws (frame, painted face), the clipboard two and the gong three.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { type BufferGeometry, MeshToonMaterial } from "three";
import type { BoardLookProps } from "../../boards/CorkBoardLook.tsx";
import { GONG_DEPTH, type GongLookProps, gongGeometry } from "../../gong/BrassGongLook.tsx";
import { createGradientMap, createToonMaterial } from "../../materials/toon.ts";
import type { ClipboardLookProps } from "../../queue/ClipboardLook.tsx";
import { PartBuilder } from "../geometry/builder.ts";
import { LAIR_TOON_DARKEST, LAIR_TOON_STEPS } from "../materials.ts";
import { LAIR } from "../palette.ts";

let shared: MeshToonMaterial | null = null;
/** One vertex-coloured toon material for every look (never disposed: it is shared). */
function lookMaterial(): MeshToonMaterial {
  shared ??= new MeshToonMaterial({
    color: 0xffffff,
    vertexColors: true,
    gradientMap: createGradientMap(LAIR_TOON_STEPS, LAIR_TOON_DARKEST),
  });
  return shared;
}

/** A geometry built from the look's size, disposed when the size changes or the look unmounts. */
function useBuilt(build: () => BufferGeometry, deps: readonly unknown[]): BufferGeometry {
  const geo = useMemo(build, deps);
  useEffect(() => () => geo.dispose(), [geo]);
  return geo;
}

function useHighlight() {
  const m = useMemo(() => createToonMaterial(LAIR.yellow), []);
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

/** Board frame: riveted steel with a yellow lip and a red status lamp. */
export function boardFrame(w: number, h: number): BufferGeometry {
  const b = new PartBuilder(401);
  const border = 0.08;
  const fw = w + border * 2;
  const fh = h + border * 2;
  b.box([fw, border, 0.06], [0, h / 2 + border / 2, 0.03], LAIR.steelDark);
  b.box([fw, border, 0.06], [0, -h / 2 - border / 2, 0.03], LAIR.steelDark);
  b.box([border, h, 0.06], [-w / 2 - border / 2, 0, 0.03], LAIR.steelDark);
  b.box([border, h, 0.06], [w / 2 + border / 2, 0, 0.03], LAIR.steelDark);
  b.panelZ(-w / 2, -h / 2, w / 2, h / 2, 0.002, LAIR.black);
  b.box([fw, 0.03, 0.02], [0, -fh / 2 + 0.015, 0.07], LAIR.yellow);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      b.rivetZ(sx * (w / 2 + border / 2), sy * (h / 2 + border / 2), 0.06, LAIR.steelLight, 0.02);
  b.box([0.06, 0.06, 0.05], [w / 2 + border / 2, h / 2 + border + 0.04, 0.04], LAIR.red);
  return b.build();
}

export function LairBoardLook({ w, h, texture, highlighted }: BoardLookProps) {
  const frame = useBuilt(() => boardFrame(w, h), [w, h]);
  const glow = useHighlight();
  return (
    <group>
      {highlighted && (
        <mesh position={[0, 0, 0.005]} material={glow}>
          <boxGeometry args={[w + 0.26, h + 0.26, 0.01]} />
        </mesh>
      )}
      <mesh geometry={frame} material={lookMaterial()} />
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

/** Clipboard: a steel board on a wall hook with a chrome clip and a yellow tab. */
export function clipboardBody(w: number, h: number): BufferGeometry {
  const b = new PartBuilder(402);
  const margin = 0.04;
  b.box([0.04, 0.06, 0.04], [0, h / 2 + 0.05, 0.02], LAIR.steelDark);
  b.box([w, h, 0.02], [0, 0, 0.014], LAIR.steelPaint);
  b.box([w * 0.45, margin * 1.4, 0.022], [0, h / 2 - margin * 0.8, 0.035], LAIR.chrome);
  b.box([w * 0.2, margin * 0.6, 0.01], [0, h / 2 - margin * 0.2, 0.048], LAIR.yellow);
  return b.build();
}

export function LairClipboardLook({ w, h, texture, highlighted }: ClipboardLookProps) {
  const body = useBuilt(() => clipboardBody(w, h), [w, h]);
  const glow = useHighlight();
  const margin = 0.04;
  return (
    <group>
      {highlighted && (
        <mesh position={[0, 0, 0.004]} material={glow}>
          <boxGeometry args={[w + 0.08, h + 0.08, 0.008]} />
        </mesh>
      )}
      <mesh geometry={body} material={lookMaterial()} />
      <mesh position={[0, -margin / 2, 0.025]}>
        <planeGeometry args={[w - margin * 2, h - margin * 3]} />
        <meshBasicMaterial
          map={texture}
          color={texture ? "#FFFFFF" : LAIR.cream}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Gong gantry: steel posts on feet and a crossbar (the static part). */
export function gongStand(w: number, h: number, floor: number): BufferGeometry {
  const g = gongGeometry(w, h);
  const b = new PartBuilder(403);
  const z = GONG_DEPTH;
  const postX = w / 2 - g.post / 2;
  for (const x of [-postX, postX]) {
    b.box(
      [g.post + 0.02, h / 2 + floor, g.post + 0.02],
      [x, (h / 2 - floor) / 2, z],
      LAIR.steelDark,
    );
    b.box([0.2, 0.06, 0.24], [x, -floor + 0.03, z], LAIR.steelDark);
    b.rivetZ(x, g.top - 0.1, z + g.post / 2 + 0.011, LAIR.steelLight, 0.015);
  }
  b.box([w + 0.1, 0.09, 0.09], [0, g.top, z], LAIR.steelDark);
  b.hazardZ(-w / 2, g.top - 0.03, w / 2, g.top + 0.03, z + 0.046, 8);
  return b.build();
}

/** The swinging chains and the disc's boss, in the swing group's space. */
export function gongChains(w: number, h: number): BufferGeometry {
  const g = gongGeometry(w, h);
  const b = new PartBuilder(404);
  for (const k of [-0.45, 0.45])
    b.box([0.018, g.cord + 0.04, 0.018], [k * g.r, -g.cord / 2, 0], LAIR.red);
  b.cylinder(g.r * 0.3, g.r * 0.34, 0.02, 16, [0, g.discY, 0.02], "#9C7A18", {
    rot: [Math.PI / 2, 0, 0],
  });
  return b.build();
}

export function LairGongLook({ w, h, floor, highlighted, swingRef, glow }: GongLookProps) {
  const g = gongGeometry(w, h);
  const stand = useBuilt(() => gongStand(w, h, floor), [w, h, floor]);
  const chains = useBuilt(() => gongChains(w, h), [w, h]);
  const halo = useHighlight();
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
  return (
    <group>
      <mesh geometry={stand} material={lookMaterial()} />
      <group position={[0, g.top - 0.045, GONG_DEPTH]} ref={swingRef}>
        {highlighted && (
          <mesh position={[0, g.discY, -0.02]} rotation-x={Math.PI / 2} material={halo}>
            <cylinderGeometry args={[g.r + 0.035, g.r + 0.035, 0.01, 28]} />
          </mesh>
        )}
        <mesh geometry={chains} material={lookMaterial()} />
        <mesh position={[0, g.discY, 0]} rotation-x={Math.PI / 2} material={brass}>
          <cylinderGeometry args={[g.r, g.r * 0.96, 0.03, 28]} />
        </mesh>
      </group>
    </group>
  );
}
