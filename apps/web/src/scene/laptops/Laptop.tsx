/**
 * Procedural laptop (the Kenney furniture set has none): a thin base and a
 * lid tilted back, with the screen as an unlit plane. The screen shows the
 * henchman's texture, a dark panel for a free desk, or (focused desk only) a
 * live xterm passed in as `live`.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  type CanvasTexture,
  Matrix4,
  MeshBasicMaterial,
  type MeshToonMaterial,
  PlaneGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createToonMaterial } from "../materials/toon.ts";
import { LAPTOP_DIMENSIONS } from "./dimensions.ts";
import type { LaptopPlacement } from "./placement.ts";
import { SCREEN_COLORS } from "./screenPaint.ts";

interface Shared {
  /** Base and tilted lid in one geometry: one draw per laptop body (#186, SPEC §11). */
  body3d: BufferGeometry;
  screen: PlaneGeometry;
  body: MeshToonMaterial;
  off: MeshBasicMaterial;
}

/** The base box, and the lid box hinged at the base's back edge and tilted back. */
function laptopBodyGeometry(): BufferGeometry {
  const L = LAPTOP_DIMENSIONS;
  const base = new BoxGeometry(L.w, L.baseH, L.d).translate(0, L.baseH / 2, 0);
  const lid = new BoxGeometry(L.w, L.lidH, L.lidT)
    .translate(0, L.lidH / 2, 0)
    .applyMatrix4(new Matrix4().makeRotationX(-L.tilt))
    .applyMatrix4(new Matrix4().makeTranslation(0, L.baseH, -L.d / 2 + L.lidT / 2));
  const merged = mergeGeometries([base, lid]);
  base.dispose();
  lid.dispose();
  if (!merged) throw new Error("laptop geometry did not merge");
  return merged;
}

let shared: Shared | null = null;
/** Geometry and materials are shared by every laptop. */
function sharedParts(): Shared {
  const L = LAPTOP_DIMENSIONS;
  shared ??= {
    body3d: laptopBodyGeometry(),
    screen: new PlaneGeometry(L.screenW, L.screenH),
    body: createToonMaterial("#B9BEC6"),
    off: new MeshBasicMaterial({ color: SCREEN_COLORS.off, toneMapped: false }),
  };
  return shared;
}

export interface LaptopProps {
  placement: LaptopPlacement;
  /** Henchman screen; null for a free desk (dark screen). */
  texture: CanvasTexture | null;
  /** Live DOM panel mounted on the screen (focused desk). */
  live?: ReactNode;
  onSelect?: () => void;
  /** Object name (`laptop-<seatId>` unless given; e2e probes find laptops by it). */
  name?: string;
}

export function Laptop({ placement, texture, live, onSelect, name }: LaptopProps) {
  const L = LAPTOP_DIMENSIONS;
  const parts = sharedParts();
  const screenMaterial = useMemo(
    () => (texture ? new MeshBasicMaterial({ map: texture, toneMapped: false }) : null),
    [texture],
  );
  useEffect(() => () => screenMaterial?.dispose(), [screenMaterial]);
  const click = onSelect
    ? (event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect();
      }
    : undefined;
  return (
    <group
      position={placement.position as [number, number, number]}
      rotation-y={placement.rotationY}
      name={name ?? `laptop-${placement.seatId}`}
      onClick={click}
      onPointerOver={onSelect ? () => (document.body.style.cursor = "pointer") : undefined}
      onPointerOut={onSelect ? () => (document.body.style.cursor = "") : undefined}
    >
      <mesh geometry={parts.body3d} material={parts.body} />
      <group position={[0, L.baseH, -L.d / 2 + L.lidT / 2]} rotation-x={-L.tilt}>
        <mesh
          geometry={parts.screen}
          material={screenMaterial ?? parts.off}
          position={[0, L.lidH / 2 + 0.004, L.lidT / 2 + 0.001]}
        />
        {live && <group position={[0, L.lidH / 2 + 0.004, L.lidT / 2 + 0.002]}>{live}</group>}
      </group>
    </group>
  );
}
