/**
 * The mountain round the compound (#188; the #190 note that the compound
 * floated on a flat dark plane): mountain.ts's heightfield as one mesh with
 * the lair's cutaway material, so rock between the camera and the player
 * fades like the walls. Rebuilt only when the layout changes. The
 * software-WebGL tier leaves it out, as it left out the old bedrock plane:
 * there every pixel of rock is CPU work. Under the rock lies a flat floor of
 * cut rock over the mountain's footprint (#190): where the cutaway fades rock
 * near the camera you see the mountain's dark inside, not the void below.
 */
import type { TileRect } from "@regulus/protocol";
import { useEffect, useMemo } from "react";
import { type BufferGeometry, Color, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import { useLairMaterials } from "../../lair/components/LairKit.tsx";
import { LAIR } from "../../lair/palette.ts";
import type { CompoundWorld } from "../world.ts";
import type { OutsideLayout } from "./layout.ts";
import { MARGIN, mountainGeometry } from "./mountain.ts";

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

/** The cut-rock floor's rectangle, metres: the mountain's footprint down to the compound's south edge. */
export function bedrockRect(width: number, depth: number, tileMetres: number) {
  const x0 = -MARGIN.side * tileMetres;
  const x1 = (width + MARGIN.side) * tileMetres;
  const z0 = -MARGIN.north * tileMetres;
  const z1 = depth * tileMetres;
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

/** Just under the floor slabs (8 cm) of rooms and corridors. */
const BEDROCK_Y = -0.12;

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
  const key = `${world.version}:${world.width}:${world.depth}:${world.rooms.map((r) => `${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.d}`).join(";")}`;
  const geo = useMemo(
    () =>
      mountainGeometry({
        width: world.width,
        depth: world.depth,
        tileMetres: world.tileMetres,
        open: openTiles(world),
        layout,
      }),
    [key, layout],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  const bed = bedrockRect(world.width, world.depth, world.tileMetres);
  const floor = useMemo(() => new PlaneGeometry(bed.w, bed.d), [bed.w, bed.d]);
  const floorMaterial = useMemo(
    () => new MeshBasicMaterial({ color: new Color(LAIR.rockCut) }),
    [],
  );
  useEffect(
    () => () => {
      floor.dispose();
      floorMaterial.dispose();
    },
    [floor, floorMaterial],
  );
  return (
    <>
      <mesh name="mountain" geometry={geo} material={mats.cutBody} raycast={() => null} />
      <mesh
        name="mountain-bedrock"
        geometry={floor}
        material={floorMaterial}
        position={[bed.cx, BEDROCK_Y, bed.cz]}
        rotation-x={-Math.PI / 2}
        raycast={() => null}
      />
    </>
  );
}
