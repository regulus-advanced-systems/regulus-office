/**
 * Non-interactable wall decoration (#118 review): a clock, a corkboard with
 * notes, a framed poster and a small shelf with a plant and books. Drawn from
 * `template.wallDecor`, hung like anchors (`anchorPlacement`).
 */
import {
  type FloorTemplate,
  type Palette,
  type WallDecor as WallDecorItem,
  wallById,
} from "@regulus/floor-layout";
import { useEffect, useMemo } from "react";
import type { MeshToonMaterial } from "three";
import { createToonMaterial, darken } from "../materials/toon.ts";
import { anchorPlacement } from "./placement.ts";

export const DECOR_COLORS = {
  clockRim: "#2B2F3A",
  clockFace: "#FFF9EF",
  hand: "#2B2F3A",
  cork: "#C9A06A",
  frame: "#5A3A1E",
  noteYellow: "#F5C542",
  notePink: "#FF9EB5",
  noteBlue: "#8FD3F4",
  posterA: "#2DBFE8",
  posterB: "#F26522",
  posterC: "#FFF6D9",
  potTerracotta: "#C0643A",
  leaf: "#3E9E5A",
} as const;

type Mats = Record<keyof typeof DECOR_COLORS, MeshToonMaterial> & { wood: MeshToonMaterial };
type Vec3 = readonly [number, number, number];

function Slab({ size, position, m }: { size: Vec3; position: Vec3; m: MeshToonMaterial }) {
  return (
    <mesh position={position} material={m}>
      <boxGeometry args={[size[0], size[1], size[2]]} />
    </mesh>
  );
}

/** Sticky-note offsets on a corkboard, as fractions of its size (x, y) and a colour key. */
export const CORK_NOTES = [
  [-0.3, 0.2, "noteYellow"],
  [0.05, 0.25, "notePink"],
  [0.3, 0.1, "noteBlue"],
  [-0.2, -0.2, "noteBlue"],
  [0.2, -0.22, "noteYellow"],
] as const;

function Piece({ item, m }: { item: WallDecorItem; m: Mats }) {
  const { w, h } = item;
  switch (item.kind) {
    case "clock": {
      const r = Math.min(w, h) / 2;
      return (
        <group rotation-x={Math.PI / 2}>
          <mesh position={[0, 0.02, 0]} material={m.clockRim}>
            <cylinderGeometry args={[r, r, 0.04, 24]} />
          </mesh>
          <mesh position={[0, 0.045, 0]} material={m.clockFace}>
            <cylinderGeometry args={[r * 0.85, r * 0.85, 0.01, 24]} />
          </mesh>
          <Slab size={[0.02, 0.01, r * 0.6]} position={[0, 0.055, -r * 0.3]} m={m.hand} />
          <Slab size={[r * 0.45, 0.01, 0.02]} position={[r * 0.22, 0.055, 0]} m={m.hand} />
        </group>
      );
    }
    case "corkboard":
      return (
        <>
          <Slab size={[w, h, 0.03]} position={[0, 0, 0.015]} m={m.frame} />
          <Slab size={[w - 0.06, h - 0.06, 0.02]} position={[0, 0, 0.03]} m={m.cork} />
          {CORK_NOTES.map(([fx, fy, color]) => (
            <Slab
              key={`${fx}-${fy}`}
              size={[w * 0.18, h * 0.22, 0.01]}
              position={[fx * w, fy * h, 0.045]}
              m={m[color]}
            />
          ))}
        </>
      );
    case "poster":
      return (
        <>
          <Slab size={[w, h, 0.03]} position={[0, 0, 0.015]} m={m.frame} />
          <Slab size={[w - 0.08, h - 0.08, 0.01]} position={[0, 0, 0.035]} m={m.posterC} />
          <Slab size={[w * 0.6, h * 0.35, 0.01]} position={[0, h * 0.12, 0.042]} m={m.posterA} />
          <Slab size={[w * 0.35, h * 0.12, 0.01]} position={[0, -h * 0.25, 0.042]} m={m.posterB} />
        </>
      );
    case "shelf":
      return (
        <>
          <Slab size={[w, 0.04, 0.25]} position={[0, -h / 2, 0.125]} m={m.wood} />
          <mesh position={[-w * 0.3, -h / 2 + 0.1, 0.12]} material={m.potTerracotta}>
            <cylinderGeometry args={[0.07, 0.05, 0.14, 10]} />
          </mesh>
          <mesh position={[-w * 0.3, -h / 2 + 0.24, 0.12]} material={m.leaf}>
            <sphereGeometry args={[0.1, 10, 8]} />
          </mesh>
          <Slab size={[0.05, 0.2, 0.16]} position={[w * 0.15, -h / 2 + 0.12, 0.12]} m={m.posterA} />
          <Slab
            size={[0.05, 0.18, 0.16]}
            position={[w * 0.21, -h / 2 + 0.11, 0.12]}
            m={m.posterB}
          />
          <Slab
            size={[0.05, 0.22, 0.16]}
            position={[w * 0.27, -h / 2 + 0.13, 0.12]}
            m={m.noteYellow}
          />
        </>
      );
  }
}

export function WallDecor({ template, palette }: { template: FloorTemplate; palette: Palette }) {
  const m = useMemo(() => {
    const out = {} as Mats;
    for (const k of Object.keys(DECOR_COLORS) as (keyof typeof DECOR_COLORS)[])
      out[k] = createToonMaterial(DECOR_COLORS[k]);
    out.wood = createToonMaterial(darken(palette.accent, 0.9));
    return out;
  }, [palette]);
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return (
    <group name="wall-decor">
      {template.wallDecor.map((item) => {
        const wall = wallById(template, item.wallId);
        if (!wall) return null;
        const p = anchorPlacement(wall, item);
        return (
          <group key={item.id} position={p.position} rotation-y={p.rotationY}>
            <Piece item={item} m={m} />
          </group>
        );
      })}
    </group>
  );
}
