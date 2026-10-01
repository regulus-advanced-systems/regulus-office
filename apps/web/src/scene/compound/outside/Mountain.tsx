/**
 * The mountain round the compound (#188; the #190 note that the compound
 * floated on a flat dark plane): mountain.ts's heightfield as one mesh with
 * the lair's cutaway material, so rock between the camera and the player
 * fades like the walls. Rebuilt only when the layout changes. In the
 * software-WebGL tier the light is baked into the vertex colours and the
 * mesh drawn unlit, which costs a fraction per pixel.
 */
import type { TileRect } from "@regulus/protocol";
import { useEffect, useMemo } from "react";
import { type BufferGeometry, Vector3 } from "three";
import { useLairMaterials } from "../../lair/components/LairKit.tsx";
import { useQualityStore } from "../quality.ts";
import type { CompoundWorld } from "../world.ts";
import type { OutsideLayout } from "./layout.ts";
import { mountainGeometry } from "./mountain.ts";

const SUN = new Vector3(-0.45, 0.8, 0.4).normalize();

/** Multiply each vertex colour by a simple sun-and-sky term (for unlit drawing). */
export function bakeLight(geo: BufferGeometry): BufferGeometry {
  const n = geo.getAttribute("normal");
  const c = geo.getAttribute("color");
  for (let i = 0; i < c.count; i++) {
    const lambert = Math.max(0, n.getX(i) * SUN.x + n.getY(i) * SUN.y + n.getZ(i) * SUN.z);
    const k = 0.5 + 0.55 * lambert + 0.12 * Math.max(0, n.getY(i));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
  return geo;
}

/** Tiles with no rock over them: rooms and corridors. */
export function openTiles(world: CompoundWorld): TileRect[] {
  return [...world.rooms.map((r) => r.rect), ...world.corridors];
}

export function Mountain({
  world,
  layout,
}: {
  world: CompoundWorld;
  layout: OutsideLayout | null;
}) {
  const mats = useLairMaterials();
  const low = useQualityStore((s) => s.quality) === "low";
  const key = `${world.version}:${world.width}:${world.depth}:${world.rooms.map((r) => `${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.d}`).join(";")}`;
  const geo = useMemo(() => {
    const g = mountainGeometry({
      width: world.width,
      depth: world.depth,
      tileMetres: world.tileMetres,
      open: openTiles(world),
      layout,
    });
    return low ? bakeLight(g) : g;
  }, [key, layout, low]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh
      name="mountain"
      geometry={geo}
      material={low ? mats.cutGlow : mats.cutBody}
      raycast={() => null}
    />
  );
}
