/**
 * Procedural pieces for the lived-in pass (#118 review): a bookshelf full of
 * books (one instanced mesh), a planter box with small Kenney plants, and the
 * small props on furniture (desk plants, books, mugs, fruit bowls).
 */
import type { RoomTemplate, Palette, Rect } from "@regulus/room-layout";
import { useEffect, useMemo, useRef } from "react";
import { Color, type InstancedMesh, Matrix4, type MeshToonMaterial } from "three";
import { createToonMaterial, darken } from "../materials/toon.ts";
import { MODEL_URLS, PLACEHOLDER_HEIGHTS, smallPlantUrl } from "./catalog.ts";
import { GltfProp } from "./GltfProp.tsx";
import { planterPlants, propPlacements, shelfBooks } from "./livedIn.ts";

type Vec3 = readonly [number, number, number];

function Box({
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

function useToon(color: string): MeshToonMaterial {
  const m = useMemo(() => createToonMaterial(color), [color]);
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

const SHELVES = 4;

/** Open wooden bookshelf with its back to the nearest wall and instanced books on each board. */
export function Bookshelf({
  rect,
  heading,
  palette,
}: {
  rect: Rect;
  heading: number;
  palette: Palette;
}) {
  const h = PLACEHOLDER_HEIGHTS.bookshelf;
  const along = Math.abs(Math.sin(heading)) > 0.5 ? rect.d : rect.w;
  const depth = Math.abs(Math.sin(heading)) > 0.5 ? rect.w : rect.d;
  const wood = useToon(darken(palette.accent, 0.85));
  const white = useToon("#FFFFFF");
  const books = useMemo(() => shelfBooks(along - 0.08, h, SHELVES), [along, h]);
  const ref = useRef<InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const c = new Color();
    books.forEach((b, i) => {
      m.makeScale(b.w, b.h, depth * 0.7);
      m.setPosition(b.x, b.y + b.h / 2, 0.02);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(b.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [books, depth]);
  const board = 0.03;
  return (
    <group
      position={[rect.x + rect.w / 2, 0, rect.z + rect.d / 2]}
      rotation-y={heading - Math.PI}
      name="bookshelf"
    >
      <Box size={[board, h, depth]} position={[-along / 2 + board / 2, h / 2, 0]} material={wood} />
      <Box size={[board, h, depth]} position={[along / 2 - board / 2, h / 2, 0]} material={wood} />
      <Box size={[along, h, 0.02]} position={[0, h / 2, -depth / 2 + 0.01]} material={wood} />
      {Array.from({ length: SHELVES + 1 }, (_, s) => (
        <Box
          key={s}
          size={[along, board, depth]}
          position={[0, (s * h) / SHELVES + board / 2, 0]}
          material={wood}
        />
      ))}
      <instancedMesh ref={ref} args={[undefined, white, books.length]}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
    </group>
  );
}

/** Low wooden planter box with a row of small plants. */
export function Planter({ id, rect, palette }: { id: string; rect: Rect; palette: Palette }) {
  const h = PLACEHOLDER_HEIGHTS.planter;
  const wood = useToon(palette.accent);
  const soil = useToon("#5A3A1E");
  const plants = useMemo(() => planterPlants(rect), [rect]);
  return (
    <group name="planter">
      <Box
        size={[rect.w, h, rect.d]}
        position={[rect.x + rect.w / 2, h / 2, rect.z + rect.d / 2]}
        material={wood}
      />
      <Box
        size={[rect.w - 0.08, 0.02, rect.d - 0.08]}
        position={[rect.x + rect.w / 2, h + 0.005, rect.z + rect.d / 2]}
        material={soil}
      />
      {plants.map((p, i) => (
        <GltfProp
          key={`${id}-${i}`}
          spec={{ url: smallPlantUrl(`${id}-${i}`), targetHeight: 0.7, uniform: true }}
          rect={p}
          heading={0}
          palette={palette}
          y={h}
        />
      ))}
    </group>
  );
}

const PROP_COLORS = {
  mug: "#FFF9EF",
  mugAlt: "#2DBFE8",
  bowl: "#F0E0B0",
  apple: "#B83159",
  orange: "#F5A623",
  lime: "#7FBF3F",
} as const;

function Mugs({ m }: { m: Record<keyof typeof PROP_COLORS, MeshToonMaterial> }) {
  return (
    <>
      <mesh position={[0, 0.05, 0]} material={m.mug}>
        <cylinderGeometry args={[0.04, 0.035, 0.1, 10]} />
      </mesh>
      <mesh position={[0.12, 0.05, 0.06]} material={m.mugAlt}>
        <cylinderGeometry args={[0.04, 0.035, 0.1, 10]} />
      </mesh>
    </>
  );
}

function FruitBowl({ m }: { m: Record<keyof typeof PROP_COLORS, MeshToonMaterial> }) {
  return (
    <>
      <mesh position={[0, 0.04, 0]} material={m.bowl}>
        <cylinderGeometry args={[0.13, 0.08, 0.08, 14]} />
      </mesh>
      {(
        [
          [0.05, 0.1, 0, m.apple],
          [-0.05, 0.1, 0.03, m.orange],
          [0, 0.11, -0.05, m.lime],
        ] as const
      ).map(([x, y, z, mat]) => (
        <mesh key={`${x}-${z}`} position={[x, y, z]} material={mat}>
          <sphereGeometry args={[0.045, 10, 8]} />
        </mesh>
      ))}
    </>
  );
}

/** Small props standing on furniture (`template.decor`). */
export function PropLayer({ template, palette }: { template: RoomTemplate; palette: Palette }) {
  const placed = useMemo(() => propPlacements(template), [template]);
  const m = useMemo(() => {
    const out = {} as Record<keyof typeof PROP_COLORS, MeshToonMaterial>;
    for (const k of Object.keys(PROP_COLORS) as (keyof typeof PROP_COLORS)[])
      out[k] = createToonMaterial(PROP_COLORS[k]);
    return out;
  }, []);
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return (
    <group name="props">
      {placed.map(({ decor, position }) => {
        const [x, y, z] = position;
        if (decor.kind === "desk_plant" || decor.kind === "books") {
          const plant = decor.kind === "desk_plant";
          const s = plant ? 0.22 : 0.18;
          return (
            <GltfProp
              key={decor.id}
              spec={{
                url: plant ? smallPlantUrl(decor.id) : MODEL_URLS.books,
                targetHeight: plant ? 0.32 : 0.12,
                uniform: true,
              }}
              rect={{ x: x - s / 2, z: z - s / 2, w: s, d: s }}
              heading={decor.heading}
              palette={palette}
              y={y}
            />
          );
        }
        return (
          <group key={decor.id} position={[x, y, z]} rotation-y={decor.heading}>
            {decor.kind === "mugs" ? <Mugs m={m} /> : <FruitBowl m={m} />}
          </group>
        );
      })}
    </group>
  );
}
