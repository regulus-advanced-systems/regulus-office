/**
 * Box-built stand-ins for kinds with no CC0 model: the jukebox (research 03
 * §9: "model one: box + arch + coloured strips"), the elevator bank and a
 * plain block for anything else.
 */
import {
  DIRECTION,
  type Elevator,
  HEADING,
  type Palette,
  type Rect,
  type Wall,
} from "@regulus/floor-layout";
import { useMemo } from "react";
import type { MeshToonMaterial } from "three";
import { createToonMaterial, darken } from "../materials/toon.ts";
import { planeYawFacing, WALL_SURFACE_GAP } from "../room/roomPieces.ts";
import { PLACEHOLDER_HEIGHTS } from "./catalog.ts";

type Vec3 = readonly [number, number, number];

interface ToonBoxProps {
  size: Vec3;
  position: Vec3;
  material: MeshToonMaterial;
}

function ToonBox({ size, position, material }: ToonBoxProps) {
  return (
    <mesh position={position} material={material}>
      <boxGeometry args={[size[0], size[1], size[2]]} />
    </mesh>
  );
}

function useMaterials<K extends string>(colors: Record<K, string>): Record<K, MeshToonMaterial> {
  return useMemo(() => {
    const out = {} as Record<K, MeshToonMaterial>;
    for (const key of Object.keys(colors) as K[]) out[key] = createToonMaterial(colors[key]);
    return out;
  }, [colors]);
}

/** Jukebox colours: maroon body, chrome grille, HUD-accent strips (SPEC §12). */
export const JUKEBOX_COLORS = {
  body: "#7A2E3B",
  chrome: "#D9DEE3",
  amber: "#F5A623",
  cyan: "#2DBFE8",
  crimson: "#B83159",
} as const;

export interface JukeboxProps {
  rect: Rect;
  heading: number;
}

export function Jukebox({ rect, heading }: JukeboxProps) {
  const m = useMaterials(JUKEBOX_COLORS);
  const h = PLACEHOLDER_HEIGHTS.jukebox;
  const w = rect.w;
  const d = rect.d;
  const bodyH = h - w / 2;
  const front = d / 2 + 0.005;
  const stripW = 0.06;
  return (
    <group
      position={[rect.x + w / 2, 0, rect.z + d / 2]}
      rotation-y={heading - HEADING.south}
      name="jukebox"
    >
      <ToonBox size={[w, bodyH, d]} position={[0, bodyH / 2, 0]} material={m.body} />
      <mesh position={[0, bodyH, 0]} rotation-x={Math.PI / 2} material={m.body}>
        <cylinderGeometry args={[w / 2, w / 2, d, 24, 1, false, 0, Math.PI]} />
      </mesh>
      <ToonBox
        size={[w * 0.8, bodyH * 0.35, 0.02]}
        position={[0, bodyH * 0.25, front]}
        material={m.chrome}
      />
      <ToonBox
        size={[stripW, bodyH * 0.9, 0.02]}
        position={[-w / 2 + stripW, bodyH / 2, front]}
        material={m.amber}
      />
      <ToonBox
        size={[stripW, bodyH * 0.9, 0.02]}
        position={[w / 2 - stripW, bodyH / 2, front]}
        material={m.cyan}
      />
      <ToonBox
        size={[w * 0.6, 0.05, 0.02]}
        position={[0, bodyH * 0.8, front]}
        material={m.crimson}
      />
    </group>
  );
}

export const ELEVATOR_COLORS = {
  frame: "#4F636B",
  door: "#BDD1D6",
  header: "#2B2F3A",
  indicator: "#F5A623",
} as const;

export const ELEVATOR_HEIGHT = 2.4;
export const ELEVATOR_DOOR_HEIGHT = 2.1;

export interface ElevatorBankProps {
  elevator: Elevator;
  /** The full wall the doors are set into; decides which side the doors show. */
  wall: Wall | undefined;
}

export function ElevatorBank({ elevator, wall }: ElevatorBankProps) {
  const m = useMaterials(ELEVATOR_COLORS);
  const { rect } = elevator;
  const f = DIRECTION[wall?.facing ?? "south"];
  const yaw = planeYawFacing(f);
  const cx = rect.x + rect.w / 2;
  const cz = rect.z + rect.d / 2;
  const along = Math.abs(f.x) > 0 ? rect.d : rect.w;
  const depth = Math.abs(f.x) > 0 ? rect.w : rect.d;
  const face = depth / 2 + WALL_SURFACE_GAP;
  const doorW = along / 2 - 0.12;
  return (
    <group position={[cx, 0, cz]} rotation-y={yaw} name="elevator">
      <ToonBox
        size={[along, ELEVATOR_HEIGHT, depth]}
        position={[0, ELEVATOR_HEIGHT / 2, 0]}
        material={m.frame}
      />
      <ToonBox
        size={[doorW, ELEVATOR_DOOR_HEIGHT, 0.04]}
        position={[-doorW / 2 - 0.02, ELEVATOR_DOOR_HEIGHT / 2, face]}
        material={m.door}
      />
      <ToonBox
        size={[doorW, ELEVATOR_DOOR_HEIGHT, 0.04]}
        position={[doorW / 2 + 0.02, ELEVATOR_DOOR_HEIGHT / 2, face]}
        material={m.door}
      />
      <ToonBox
        size={[along * 0.9, 0.16, 0.04]}
        position={[0, ELEVATOR_DOOR_HEIGHT + 0.14, face]}
        material={m.header}
      />
      <ToonBox
        size={[0.12, 0.08, 0.05]}
        position={[0, ELEVATOR_DOOR_HEIGHT + 0.14, face]}
        material={m.indicator}
      />
    </group>
  );
}

export interface PlaceholderBoxProps {
  rect: Rect;
  height: number;
  palette: Palette;
}

/** Flat block in the palette accent for kinds without a model. */
export function PlaceholderBox({ rect, height, palette }: PlaceholderBoxProps) {
  const colors = useMemo(
    () => ({ body: palette.accent, top: darken(palette.accent, 0.9) }),
    [palette],
  );
  const m = useMaterials(colors);
  return (
    <group position={[rect.x + rect.w / 2, 0, rect.z + rect.d / 2]}>
      <ToonBox size={[rect.w, height, rect.d]} position={[0, height / 2, 0]} material={m.body} />
      <ToonBox size={[rect.w, 0.02, rect.d]} position={[0, height + 0.01, 0]} material={m.top} />
    </group>
  );
}
