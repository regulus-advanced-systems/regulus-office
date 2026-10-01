/**
 * The generated rooms' Look anchors (issue and PR boards, queue clipboard,
 * gong) drawn with the lair restyles (looks/LairLooks.tsx), as #186 would
 * pass them to BoardObject / QueueClipboard / GongObject. Debug only: no
 * board texture and no behaviour here.
 */
import { useRef } from "react";
import type { Group } from "three";
import { LairBoardLook, LairClipboardLook, LairGongLook } from "../looks/LairLooks.tsx";
import type { LookItem } from "../roomScene.ts";

const GLOW = { value: 0 };

function GongItem({ item }: { item: LookItem }) {
  const swing = useRef<Group>(null);
  return (
    <LairGongLook
      w={item.w}
      h={item.h}
      floor={item.floor}
      highlighted={false}
      swingRef={swing}
      glow={GLOW}
    />
  );
}

export function RoomLooks({ looks }: { looks: readonly LookItem[] }) {
  return (
    <group name="lair:looks">
      {looks.map((item) => (
        <group
          key={`${item.id}@${item.position.join(",")}`}
          position={item.position}
          rotation-y={item.rotationY}
        >
          {item.look === "board" && (
            <LairBoardLook w={item.w} h={item.h} texture={null} highlighted={false} />
          )}
          {item.look === "clipboard" && (
            <LairClipboardLook w={item.w} h={item.h} texture={null} highlighted={false} />
          )}
          {item.look === "gong" && <GongItem item={item} />}
        </group>
      ))}
    </group>
  );
}
