/**
 * A Kenney GLB placed from template data: cloned, toon-shaded and recoloured
 * to the palette, then scaled so its footprint covers `rect` (placement.ts).
 */
import { useGLTF } from "@react-three/drei";
import type { Palette, Rect } from "@regulus/floor-layout";
import { useMemo } from "react";
import { Box3 } from "three";
import { restyleColor, toonifyObject } from "../materials/toon.ts";
import type { ModelSpec } from "./catalog.ts";
import { boxSize, centreBottomOffset, fitToFootprint } from "./placement.ts";

export interface GltfPropProps {
  spec: ModelSpec;
  rect: Rect;
  heading: number;
  palette: Palette;
  /** Override the spec's height (e.g. a TV sized from its wall anchor). */
  targetHeight?: number;
  /** Height of the model's base above the floor (wall-mounted pieces). */
  y?: number;
}

export function GltfProp({ spec, rect, heading, palette, targetHeight, y = 0 }: GltfPropProps) {
  const gltf = useGLTF(spec.url, false, false);
  const { object, offset, size } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    toonifyObject(clone, (name) => restyleColor(name, palette));
    const bounds = new Box3().setFromObject(clone);
    return { object: clone, offset: centreBottomOffset(bounds), size: boxSize(bounds) };
  }, [gltf.scene, palette]);

  const p = fitToFootprint(size, rect, heading, {
    targetHeight: targetHeight ?? spec.targetHeight,
    uniform: spec.uniform,
    modelHeading: spec.modelHeading,
  });

  return (
    <group position={[p.position[0], y, p.position[2]]} rotation-y={p.rotationY} scale={p.scale}>
      <primitive object={object} position={offset} />
    </group>
  );
}
