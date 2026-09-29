/**
 * Procedural laptop (the Kenney furniture set has none): a thin base and a
 * lid tilted back, with the screen as an unlit plane. The screen shows the
 * robot's texture, a dark panel for a free desk, or (focused desk only) a
 * live xterm passed in as `live`.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo } from "react";
import {
  BoxGeometry,
  type CanvasTexture,
  MeshBasicMaterial,
  type MeshToonMaterial,
  PlaneGeometry,
} from "three";
import { createToonMaterial } from "../materials/toon.ts";
import { LAPTOP_DIMENSIONS } from "./dimensions.ts";
import type { LaptopPlacement } from "./placement.ts";
import { SCREEN_COLORS } from "./screenPaint.ts";

interface Shared {
  base: BoxGeometry;
  lid: BoxGeometry;
  screen: PlaneGeometry;
  body: MeshToonMaterial;
  off: MeshBasicMaterial;
}

let shared: Shared | null = null;
/** Geometry and materials are shared by every laptop. */
function sharedParts(): Shared {
  const L = LAPTOP_DIMENSIONS;
  shared ??= {
    base: new BoxGeometry(L.w, L.baseH, L.d),
    lid: new BoxGeometry(L.w, L.lidH, L.lidT),
    screen: new PlaneGeometry(L.screenW, L.screenH),
    body: createToonMaterial("#B9BEC6"),
    off: new MeshBasicMaterial({ color: SCREEN_COLORS.off, toneMapped: false }),
  };
  return shared;
}

export interface LaptopProps {
  placement: LaptopPlacement;
  /** Robot screen; null for a free desk (dark screen). */
  texture: CanvasTexture | null;
  /** Live DOM panel mounted on the screen (focused desk). */
  live?: ReactNode;
  onSelect?: () => void;
}

export function Laptop({ placement, texture, live, onSelect }: LaptopProps) {
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
      name={`laptop-${placement.seatId}`}
      onClick={click}
      onPointerOver={onSelect ? () => (document.body.style.cursor = "pointer") : undefined}
      onPointerOut={onSelect ? () => (document.body.style.cursor = "") : undefined}
    >
      <mesh geometry={parts.base} material={parts.body} position={[0, L.baseH / 2, 0]} />
      <group position={[0, L.baseH, -L.d / 2 + L.lidT / 2]} rotation-x={-L.tilt}>
        <mesh geometry={parts.lid} material={parts.body} position={[0, L.lidH / 2, 0]} />
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
