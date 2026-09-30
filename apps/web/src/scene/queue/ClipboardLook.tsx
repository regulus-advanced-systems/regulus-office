/**
 * What the queue clipboard looks like in 3D (#37), apart from where it hangs
 * and what it does (QueueClipboard), like the boards' `BoardLook` (#36): the
 * lair art kit restyles it by passing another component as `look`. Drawn in
 * local space: centred on the anchor, facing +z, the wall at z = 0.
 */
import { type ComponentType, useMemo } from "react";
import type { CanvasTexture } from "three";
import { createToonMaterial } from "../materials/toon.ts";

export interface ClipboardLookProps {
  /** Clipboard size, metres. */
  w: number;
  h: number;
  /** The painted paper; null until the first paint. */
  texture: CanvasTexture | null;
  /** Hovered, in reach, or a carried card can be dropped here. */
  highlighted: boolean;
}

export type ClipboardLook = ComponentType<ClipboardLookProps>;

const BOARD = "#8A5A2B";
const CLIP = "#B9BEC6";
const HIGHLIGHT = "#F5C542";

/** A hardboard clipboard with a metal clip and a sheet of paper (the default look). */
export function HardboardClipboardLook({ w, h, texture, highlighted }: ClipboardLookProps) {
  const board = useMemo(() => createToonMaterial(BOARD), []);
  const clip = useMemo(() => createToonMaterial(CLIP), []);
  const glow = useMemo(() => createToonMaterial(HIGHLIGHT), []);
  const margin = 0.04;
  return (
    <group>
      {highlighted && (
        <mesh position={[0, 0, 0.004]} material={glow}>
          <boxGeometry args={[w + 0.08, h + 0.08, 0.008]} />
        </mesh>
      )}
      <mesh position={[0, 0, 0.012]} material={board}>
        <boxGeometry args={[w, h, 0.016]} />
      </mesh>
      <mesh position={[0, -margin / 2, 0.021]}>
        <planeGeometry args={[w - margin * 2, h - margin * 3]} />
        <meshBasicMaterial
          map={texture}
          color={texture ? "#FFFFFF" : "#FFFDF5"}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, h / 2 - margin * 0.8, 0.03]} material={clip}>
        <boxGeometry args={[w * 0.4, margin * 1.4, 0.02]} />
      </mesh>
    </group>
  );
}
