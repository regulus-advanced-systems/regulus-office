/**
 * What a board looks like in 3D (#36), kept apart from where it hangs and
 * what it does (BoardObject) so the lair art kit (#183) can swap it: any
 * component taking {@link BoardLookProps} can be passed as `look`. Drawn in
 * the board's local space: centred on the anchor, facing +z, the wall at z = 0.
 */
import { type ComponentType, useMemo } from "react";
import type { CanvasTexture } from "three";
import { createToonMaterial } from "../materials/toon.ts";

export interface BoardLookProps {
  /** Board face size, metres. */
  w: number;
  h: number;
  /** The painted board (columns and cards); null until the first paint. */
  texture: CanvasTexture | null;
  /** Hovered or the player is in reach: draw a highlight. */
  highlighted: boolean;
}

export type BoardLook = ComponentType<BoardLookProps>;

const FRAME = "#6B4423";
const HIGHLIGHT = "#F5C542";

/** A cork board in a wooden frame (the default look). */
export function CorkBoardLook({ w, h, texture, highlighted }: BoardLookProps) {
  const frame = useMemo(() => createToonMaterial(FRAME), []);
  const glow = useMemo(() => createToonMaterial(HIGHLIGHT), []);
  const border = 0.06;
  return (
    <group>
      {highlighted && (
        <mesh position={[0, 0, 0.005]} material={glow}>
          <boxGeometry args={[w + border * 2 + 0.08, h + border * 2 + 0.08, 0.01]} />
        </mesh>
      )}
      <mesh position={[0, 0, 0.02]} material={frame}>
        <boxGeometry args={[w + border * 2, h + border * 2, 0.04]} />
      </mesh>
      <mesh position={[0, 0, 0.041]}>
        <planeGeometry args={[w, h]} />
        {/* Unlit, so the cards stay readable whatever the lighting. */}
        <meshBasicMaterial
          map={texture}
          color={texture ? "#FFFFFF" : "#C8955A"}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
