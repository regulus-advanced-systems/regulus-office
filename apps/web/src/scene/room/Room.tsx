/**
 * The dollhouse room (SPEC §12): floor, two full back walls, front stubs
 * with a dark cap, window panes, zone rugs, and the floor name on the
 * exterior stub.
 * In first-person view (SPEC §9.2) `frontWalls="full"` raises the stubs to
 * full walls without remounting anything else. Geometry comes from
 * `roomPieces`, colours from the palette, grime from a procedural multiply
 * map.
 */
import type { FloorTemplate, Palette } from "@regulus/floor-layout";
import { useEffect, useMemo } from "react";
import { type DataTexture, MeshBasicMaterial, type MeshToonMaterial } from "three";
import { createGrimeTexture } from "../materials/grime.ts";
import { createToonMaterial } from "../materials/toon.ts";
import { createNameTexture } from "./nameTexture.ts";
import { Rugs } from "./Rugs.tsx";
import {
  type FrontWallMode,
  roomColors,
  roomPieces,
  WALL_SURFACE_GAP,
  type WallPiece,
  WINDOW_FRAME,
  wallFaces,
} from "./roomPieces.ts";

export interface RoomProps {
  template: FloorTemplate;
  palette: Palette;
  /** Painted on the exterior stub; defaults to the template name. */
  floorName?: string;
  /** Dollhouse stubs (default) or full-height front walls for first person. */
  frontWalls?: FrontWallMode;
}

/** Metres of wall/floor covered by one repeat of the grime map. */
const GRIME_TILE_M = 6;

function tiledGrime(base: DataTexture, w: number, h: number): DataTexture {
  const t = base.clone();
  t.repeat.set(w / GRIME_TILE_M, h / GRIME_TILE_M);
  t.needsUpdate = true;
  return t;
}

interface RoomMaterials {
  floor: MeshToonMaterial;
  interior: Map<string, MeshToonMaterial>;
  exterior: MeshToonMaterial;
  cap: MeshToonMaterial;
  frame: MeshToonMaterial;
  pane: MeshBasicMaterial;
}

function buildMaterials(
  template: FloorTemplate,
  palette: Palette,
  pieces: ReturnType<typeof roomPieces>,
) {
  const c = roomColors(palette);
  const grime = createGrimeTexture();
  const interior = new Map<string, MeshToonMaterial>();
  for (const w of pieces.walls) {
    const len = Math.max(w.size[0], w.size[2]);
    interior.set(
      w.id,
      createToonMaterial(c.interior(w.id), { map: tiledGrime(grime, len, w.size[1]) }),
    );
  }
  const mats: RoomMaterials = {
    floor: createToonMaterial(c.floor, {
      map: tiledGrime(grime, template.size.width, template.size.depth),
    }),
    interior,
    exterior: createToonMaterial(c.exterior),
    cap: createToonMaterial(c.cap),
    frame: createToonMaterial(c.windowFrame),
    pane: new MeshBasicMaterial({ color: c.windowPane }),
  };
  return mats;
}

/** Release GPU resources when a material set is replaced (template, palette or wall mode change). */
function disposeMaterials(mats: RoomMaterials): void {
  const all = [
    mats.floor,
    mats.exterior,
    mats.cap,
    mats.frame,
    mats.pane,
    ...mats.interior.values(),
  ];
  for (const m of all) {
    m.map?.dispose();
    m.dispose();
  }
}

function wallMaterials(piece: WallPiece, mats: RoomMaterials): MeshToonMaterial[] {
  const interior = mats.interior.get(piece.id) ?? mats.exterior;
  return wallFaces(piece).map((face) => (face === "exterior" ? mats.exterior : interior));
}

export function Room({ template, palette, floorName, frontWalls = "stub" }: RoomProps) {
  const pieces = useMemo(() => roomPieces(template, { frontWalls }), [template, frontWalls]);
  const mats = useMemo(
    () => buildMaterials(template, palette, pieces),
    [template, palette, pieces],
  );
  useEffect(() => () => disposeMaterials(mats), [mats]);
  const name = pieces.name;
  const nameTex = useMemo(
    () => (name ? createNameTexture(floorName ?? template.name, name.width / name.height) : null),
    [name, floorName, template.name],
  );
  useEffect(() => () => nameTex?.dispose(), [nameTex]);

  return (
    <group name="room">
      <mesh position={pieces.floor.center} rotation-x={-Math.PI / 2} material={mats.floor}>
        <planeGeometry args={[pieces.floor.width, pieces.floor.depth]} />
      </mesh>
      <Rugs template={template} palette={palette} />
      {pieces.walls.map((w) => (
        <mesh
          key={w.id}
          position={w.center}
          material={wallMaterials(w, mats)}
          name={`wall-${w.id}`}
        >
          <boxGeometry args={[w.size[0], w.size[1], w.size[2]]} />
        </mesh>
      ))}
      {pieces.caps.map((c) => (
        <mesh key={c.id} position={c.center} material={mats.cap}>
          <boxGeometry args={[c.size[0], c.size[1], c.size[2]]} />
        </mesh>
      ))}
      {pieces.windows.map((win) => (
        <group key={win.id} position={win.center} rotation-y={win.yaw}>
          <mesh material={mats.frame}>
            <planeGeometry args={[win.width + 2 * WINDOW_FRAME, win.height + 2 * WINDOW_FRAME]} />
          </mesh>
          <mesh position-z={WALL_SURFACE_GAP / 2} material={mats.pane}>
            <planeGeometry args={[win.width, win.height]} />
          </mesh>
          <mesh position-z={WALL_SURFACE_GAP} material={mats.frame}>
            <planeGeometry args={[0.04, win.height]} />
          </mesh>
        </group>
      ))}
      {name && nameTex && (
        <mesh position={name.center} rotation-y={name.yaw} name="floor-name">
          <planeGeometry args={[name.width, name.height]} />
          <meshBasicMaterial map={nameTex} transparent depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
