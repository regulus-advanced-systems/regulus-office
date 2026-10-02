/**
 * One whiteboard on a wall (#45, SPEC §9.4 "canvas snapshot on the wall;
 * click = full-screen Excalidraw"): the look with the board's snapshot
 * texture, a hover/in-reach highlight, and a click target that walks the
 * player over and opens the editor. Placed by its caller (a room's wall
 * anchor, or the lobby dressing); drawn facing +z from its group.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { useState } from "react";
import { useSnapshotTexture } from "./snapshotTexture.ts";
import { WhiteboardLook } from "./WhiteboardLook.tsx";

export interface WhiteboardObjectProps {
  boardId: string;
  version: number;
  w: number;
  h: number;
  position: readonly [number, number, number];
  rotationY: number;
  /** Clickable (the room the player is in, or the lobby). */
  interactive: boolean;
  inReach: boolean;
  onOpen: () => void;
  name: string;
}

export function WhiteboardObject({
  boardId,
  version,
  w,
  h,
  position,
  rotationY,
  interactive,
  inReach,
  onOpen,
  name,
}: WhiteboardObjectProps) {
  const texture = useSnapshotTexture(boardId, version, w, h);
  const [hover, setHover] = useState(false);
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    onOpen();
  };
  return (
    <group position={position as [number, number, number]} rotation-y={rotationY} name={name}>
      <WhiteboardLook
        w={w}
        h={h}
        texture={texture}
        highlighted={interactive && (hover || inReach)}
      />
      {interactive && (
        <mesh
          name={`${name}-hotspot`}
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
          <boxGeometry args={[w + 0.1, h + 0.1, 0.1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
    </group>
  );
}
