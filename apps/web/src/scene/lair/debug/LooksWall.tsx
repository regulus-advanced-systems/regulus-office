/**
 * The optional lair restyles of the swappable looks (looks/LairLooks.tsx)
 * hung on the debug room's walls (#183): an issue board and the merge gong
 * on the east wall, the queue clipboard between the consoles. Drawn with no
 * board texture and no behaviour; the real objects keep their own logic.
 */
import { useRef } from "react";
import type { Group } from "three";
import { LairBoardLook, LairClipboardLook, LairGongLook } from "../looks/LairLooks.tsx";

const EAST = -Math.PI / 2;
const GLOW = { value: 0 };

export function LooksWall({ east, north }: { east: number; north: number }) {
  const swing = useRef<Group>(null);
  return (
    <group name="lair:looks">
      <group position={[east, 1.7, 10.1]} rotation-y={EAST}>
        <LairBoardLook w={1.5} h={0.95} texture={null} highlighted={false} />
      </group>
      <group position={[east, 1.5, 8.6]} rotation-y={EAST}>
        <LairGongLook w={1} h={1.2} floor={1.5} highlighted={false} swingRef={swing} glow={GLOW} />
      </group>
      <group position={[8.1, 1.5, north]}>
        <LairClipboardLook w={0.32} h={0.44} texture={null} highlighted={false} />
      </group>
    </group>
  );
}
