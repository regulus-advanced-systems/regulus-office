/**
 * One board on a wall anchor (SPEC §9.4; #36): placed from the room
 * layout's data-driven anchor (so a compound room, #182/#186, only has to
 * give it another anchor), painted from the board's columns, and clickable.
 * Its look is a swappable component (CorkBoardLook by default).
 */
import type { ThreeEvent } from "@react-three/fiber";
import type { Wall, WallAnchor } from "@regulus/floor-layout";
import { useEffect, useMemo, useState } from "react";
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import type { BoardColumnView } from "../../ui/boards/columns.ts";
import { anchorPlacement } from "../furniture/placement.ts";
import { scopedName, useRoomScope } from "../roomScope.ts";
import {
  type BoardCanvas,
  layoutBoard,
  layoutKey,
  paintBoard,
  textureSize,
} from "./boardTexture.ts";
import { type BoardLook, CorkBoardLook } from "./CorkBoardLook.tsx";

export interface BoardObjectProps {
  wall: Wall;
  anchor: WallAnchor;
  columns: readonly BoardColumnView[];
  /** The player stands in reach (`E` would open it). */
  inReach: boolean;
  onOpen: () => void;
  look?: BoardLook;
}

/**
 * The board's canvas texture, created with the component (so the material
 * compiles with its map from the first frame) and repainted when the cards
 * change.
 */
function useBoardTexture(w: number, h: number, columns: readonly BoardColumnView[]) {
  const size = useMemo(() => textureSize(w, h), [w, h]);
  const surface = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    return { texture, ctx: canvas.getContext("2d") as BoardCanvas | null };
  }, [size]);
  useEffect(() => () => surface.texture.dispose(), [surface]);
  const key = layoutKey(columns);
  useEffect(() => {
    if (!surface.ctx) return;
    paintBoard(surface.ctx, layoutBoard(columns, size));
    surface.texture.needsUpdate = true;
    // `key` stands for `columns`: repaint only when what the board shows changes.
  }, [surface, key, size]);
  return surface.texture;
}

export function BoardObject({
  wall,
  anchor,
  columns,
  inReach,
  onOpen,
  look: Look = CorkBoardLook,
}: BoardObjectProps) {
  const scope = useRoomScope();
  const p = anchorPlacement(wall, anchor, scope.wallDepth);
  const texture = useBoardTexture(anchor.w, anchor.h, columns);
  const [hover, setHover] = useState(false);
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    onOpen();
  };
  return (
    <group
      position={p.position}
      rotation-y={p.rotationY}
      name={scopedName(scope, `board-${anchor.id}`)}
    >
      <Look w={anchor.w} h={anchor.h} texture={texture} highlighted={hover || inReach} />
      {scope.interactive && (
        <mesh
          name={`board-hotspot-${anchor.id}`}
          // Hit target only: invisible objects still take pointer events but cost no draw call.
          visible={false}
          position={[0, 0, 0.1]}
          onClick={click}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHover(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHover(false);
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[anchor.w + 0.1, anchor.h + 0.1, 0.1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
    </group>
  );
}
