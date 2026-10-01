/**
 * The whiteboard as drawn on a wall anchor (#45, SPEC §9.4): a steel-framed
 * white board with a marker tray, its face showing the board's last snapshot
 * (or blank). Same contract as the board looks (BoardLookProps): drawn in the
 * anchor's local space, facing +z, the wall at z = 0. The frame is one baked
 * vertex-coloured mesh; the face is unlit so the drawing reads in a dark lair.
 */
import { useEffect, useMemo } from "react";
import { type BufferGeometry, MeshToonMaterial } from "three";
import { getGradientMap } from "../avatar/toonMaterial.ts";
import type { BoardLookProps } from "../boards/CorkBoardLook.tsx";
import { PartBuilder } from "../lair/geometry/builder.ts";
import { LAIR } from "../lair/palette.ts";

/** The board's face colour (also the snapshot background). */
export const WHITEBOARD_FACE = "#F4F5F2";
/** How far the face stands off the wall. */
export const FACE_Z = 0.032;

export function whiteboardFrame(w: number, h: number): BufferGeometry {
  const b = new PartBuilder(451);
  const border = 0.05;
  const depth = 0.045;
  const fw = w + border * 2;
  b.box([fw, h + border * 2, 0.02], [0, 0, 0.01], LAIR.steelDark);
  b.box([fw, border, depth], [0, h / 2 + border / 2, depth / 2], LAIR.steelLight);
  b.box([fw, border, depth], [0, -h / 2 - border / 2, depth / 2], LAIR.steelLight);
  b.box([border, h, depth], [-w / 2 - border / 2, 0, depth / 2], LAIR.steelLight);
  b.box([border, h, depth], [w / 2 + border / 2, 0, depth / 2], LAIR.steelLight);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      b.rivetZ(sx * (w / 2 + border / 2), sy * (h / 2 + border / 2), depth, LAIR.steelDark, 0.014);
  // Marker tray with a red and a teal marker and an eraser.
  const trayY = -h / 2 - border - 0.02;
  b.box([Math.min(w * 0.5, 1), 0.03, 0.08], [0, trayY, 0.04], LAIR.steelDark);
  b.box([0.13, 0.018, 0.018], [-0.12, trayY + 0.024, 0.05], LAIR.red);
  b.box([0.13, 0.018, 0.018], [0.05, trayY + 0.024, 0.06], LAIR.teal);
  b.box([0.1, 0.03, 0.04], [0.22, trayY + 0.03, 0.05], LAIR.black);
  return b.build();
}

let frameMaterial: MeshToonMaterial | null = null;
function material(): MeshToonMaterial {
  frameMaterial ??= new MeshToonMaterial({
    color: 0xffffff,
    vertexColors: true,
    gradientMap: getGradientMap(),
  });
  return frameMaterial;
}

export function WhiteboardLook({ w, h, texture, highlighted }: BoardLookProps) {
  const frame = useMemo(() => whiteboardFrame(w, h), [w, h]);
  useEffect(() => () => frame.dispose(), [frame]);
  return (
    <group>
      {highlighted && (
        <mesh position={[0, 0, 0.004]}>
          <boxGeometry args={[w + 0.22, h + 0.22, 0.008]} />
          <meshBasicMaterial color={LAIR.yellow} toneMapped={false} />
        </mesh>
      )}
      <mesh geometry={frame} material={material()} />
      <mesh position={[0, 0, FACE_Z]} name="whiteboard-face">
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial
          map={texture}
          color={texture ? "#FFFFFF" : WHITEBOARD_FACE}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
