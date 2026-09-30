/**
 * Things hung on wall anchors (SPEC §9.4): the usage screens (#40, live,
 * scene/usage/), and static placeholders for the whiteboard, picture frames
 * and the lounge TV (Kenney model). Live content for each is its own issue.
 * Issue and PR boards are drawn by scene/boards (#36) on their anchors.
 */
import {
  type FloorTemplate,
  type Palette,
  type Wall,
  type WallAnchor,
  wallById,
} from "@regulus/floor-layout";
import { useMemo } from "react";
import type { MeshToonMaterial } from "three";
import { createToonMaterial } from "../materials/toon.ts";
import { UsageScreen } from "../usage/UsageScreen.tsx";
import { TV_MODEL } from "./catalog.ts";
import { GltfProp } from "./GltfProp.tsx";
import { anchorPlacement, wallPropPlacement } from "./placement.ts";

type Vec3 = readonly [number, number, number];

export const ANCHOR_COLORS = {
  frame: "#D9D9D9",
  white: "#FFFFFF",
  pictureFrame: "#5A3A1E",
  pictureInner: "#FFF9EF",
} as const;

type Mats = Record<keyof typeof ANCHOR_COLORS, MeshToonMaterial>;

function Slab({
  size,
  position,
  material,
}: {
  size: Vec3;
  position: Vec3;
  material: MeshToonMaterial;
}) {
  return (
    <mesh position={position} material={material}>
      <boxGeometry args={[size[0], size[1], size[2]]} />
    </mesh>
  );
}

function Whiteboard({ w, h, m }: { w: number; h: number; m: Mats }) {
  return (
    <>
      <Slab size={[w + 0.1, h + 0.1, 0.03]} position={[0, 0, 0.015]} material={m.frame} />
      <Slab size={[w, h, 0.02]} position={[0, 0, 0.035]} material={m.white} />
      <Slab size={[w * 0.6, 0.05, 0.02]} position={[0, -h / 2 - 0.02, 0.05]} material={m.frame} />
    </>
  );
}

function Picture({ w, h, m }: { w: number; h: number; m: Mats }) {
  return (
    <>
      <Slab size={[w + 0.06, h + 0.06, 0.03]} position={[0, 0, 0.015]} material={m.pictureFrame} />
      <Slab size={[w, h, 0.02]} position={[0, 0, 0.035]} material={m.pictureInner} />
    </>
  );
}

function Anchor({
  wall,
  anchor,
  palette,
  m,
}: {
  wall: Wall;
  anchor: WallAnchor;
  palette: Palette;
  m: Mats;
}) {
  if (anchor.kind === "tv") {
    const tv = wallPropPlacement(wall, anchor);
    return (
      <GltfProp
        spec={TV_MODEL}
        rect={tv.rect}
        heading={tv.heading}
        palette={palette}
        targetHeight={anchor.h}
        y={tv.y}
      />
    );
  }
  const p = anchorPlacement(wall, anchor);
  return (
    <group position={p.position} rotation-y={p.rotationY} name={anchor.id}>
      {anchor.kind === "whiteboard" && <Whiteboard w={anchor.w} h={anchor.h} m={m} />}
      {anchor.kind === "usage_wall" && <UsageScreen w={anchor.w} h={anchor.h} />}
      {anchor.kind === "picture" && <Picture w={anchor.w} h={anchor.h} m={m} />}
      {anchor.kind === "queue_clipboard" && <Picture w={anchor.w} h={anchor.h} m={m} />}
    </group>
  );
}

export function WallAnchors({ template, palette }: { template: FloorTemplate; palette: Palette }) {
  const m = useMemo(() => {
    const out = {} as Mats;
    for (const k of Object.keys(ANCHOR_COLORS) as Array<keyof typeof ANCHOR_COLORS>)
      out[k] = createToonMaterial(ANCHOR_COLORS[k]);
    return out;
  }, []);
  return (
    <group name="wall-anchors">
      {template.wallAnchors.map((anchor) => {
        const wall = wallById(template, anchor.wallId);
        return wall ? (
          <Anchor key={anchor.id} wall={wall} anchor={anchor} palette={palette} m={m} />
        ) : null;
      })}
    </group>
  );
}
