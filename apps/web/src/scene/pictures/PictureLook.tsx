/**
 * A wall picture as drawn (#46): a slim walnut frame and the image on an
 * unlit face, so it reads in a dark lair as well as in the day shift (the
 * whiteboard's face does the same). Drawn in the picture's local space,
 * facing +z, the wall at z = 0. `tint` outlines it: yellow when hovered or
 * selected, green or red for the placement ghost; `opacity` < 1 for a ghost.
 */
import { useEffect, useMemo } from "react";
import { type BufferGeometry, MeshToonMaterial, type Texture } from "three";
import { getGradientMap } from "../avatar/toonMaterial.ts";
import { PartBuilder } from "../lair/geometry/builder.ts";
import { LAIR } from "../lair/palette.ts";

/** Frame border and depth, metres. */
export const PICTURE_BORDER = 0.035;
export const PICTURE_DEPTH = 0.03;
/** The face, a hair in front of the frame's back. */
const FACE_Z = 0.022;
/** Mat colour shown while the image loads. */
export const PICTURE_MAT = "#EDE6D8";

export function pictureFrame(w: number, h: number): BufferGeometry {
  const b = new PartBuilder(46);
  const t = PICTURE_BORDER;
  const d = PICTURE_DEPTH;
  b.box([w + 2 * t, h + 2 * t, 0.012], [0, 0, 0.006], LAIR.walnutDark);
  b.box([w + 2 * t, t, d], [0, h / 2 + t / 2, d / 2], LAIR.walnut);
  b.box([w + 2 * t, t, d], [0, -h / 2 - t / 2, d / 2], LAIR.walnut);
  b.box([t, h, d], [-w / 2 - t / 2, 0, d / 2], LAIR.walnut);
  b.box([t, h, d], [w / 2 + t / 2, 0, d / 2], LAIR.walnut);
  return b.build();
}

let frameMaterial: MeshToonMaterial | null = null;
function material(): MeshToonMaterial {
  frameMaterial ??= new MeshToonMaterial({
    color: 0xffffff,
    vertexColors: true,
    gradientMap: getGradientMap(),
  });
  return frameMaterial;
}

export interface PictureLookProps {
  w: number;
  h: number;
  texture: Texture | null;
  tint?: string | null;
  opacity?: number;
}

export function PictureLook({ w, h, texture, tint = null, opacity = 1 }: PictureLookProps) {
  const frame = useMemo(() => pictureFrame(w, h), [w, h]);
  useEffect(() => () => frame.dispose(), [frame]);
  const ghost = opacity < 1;
  return (
    <group>
      {tint && (
        <mesh position={[0, 0, 0.003]} raycast={() => null}>
          <boxGeometry
            args={[w + 2 * PICTURE_BORDER + 0.08, h + 2 * PICTURE_BORDER + 0.08, 0.006]}
          />
          <meshBasicMaterial
            color={tint}
            toneMapped={false}
            transparent={ghost}
            opacity={ghost ? 0.85 : 1}
          />
        </mesh>
      )}
      {!ghost && <mesh geometry={frame} material={material()} raycast={() => null} />}
      <mesh position={[0, 0, FACE_Z]} name="picture-face" raycast={() => null}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial
          // A map appearing later needs another shader program: a new material, not a prop change.
          key={texture ? "image" : "blank"}
          map={texture}
          color={texture ? "#FFFFFF" : PICTURE_MAT}
          toneMapped={false}
          transparent={ghost}
          opacity={opacity}
          depthWrite={!ghost}
        />
      </mesh>
    </group>
  );
}
