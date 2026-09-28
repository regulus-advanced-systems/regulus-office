/**
 * Floating name plate for humans (SPEC §9.3): one billboard sprite with a
 * cached canvas texture. Sprites always face the camera and cost one quad,
 * unlike drei `<Html>` which adds a DOM node per label (SPEC §11 caps live
 * DOM panels at 2).
 */
import { useMemo } from "react";
import {
  HUMAN_PLATE_STYLE,
  type NamePlateStyle,
  namePlateTextureFor,
  PLATE_WORLD_HEIGHT,
} from "./namePlateTexture.ts";

export type NamePlateProps = {
  name: string;
  style?: NamePlateStyle;
  /** World-space height above the avatar origin. */
  height: number;
};

export function NamePlate({ name, style = HUMAN_PLATE_STYLE, height }: NamePlateProps) {
  const plate = useMemo(() => namePlateTextureFor(name, style), [name, style]);
  return (
    <sprite
      position={[0, height, 0]}
      scale={[PLATE_WORLD_HEIGHT * plate.aspect, PLATE_WORLD_HEIGHT, 1]}
      center-y={0}
      renderOrder={10}
    >
      <spriteMaterial map={plate.texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
