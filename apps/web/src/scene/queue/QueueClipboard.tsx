/**
 * The room's task queue on the wall (SPEC §9.4; #37): one clipboard per
 * `queue_clipboard` wall anchor, painted with the running and next tasks.
 * A click (or `E` in reach) opens the queue panel; while the human carries a
 * board card (#36), the clipboard is a drop target: the card goes down and
 * the "Queue a task" dialog opens prefilled from it.
 */
import type { ThreeEvent } from "@react-three/fiber";
import type { QueueTask } from "@regulus/protocol";
import type { RoomTemplate, Wall, WallAnchor } from "@regulus/room-layout";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import { usePlayerStore } from "../../state/player.ts";
import { dropCard, useMyCarried } from "../../ui/boards/carry.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { cardQueuePrefill } from "../../ui/queue/queueModel.ts";
import { useQueueStore } from "../../ui/queue/queueStore.ts";
import type { BoardCanvas } from "../boards/boardTexture.ts";
import { anchorPlacement } from "../furniture/placement.ts";
import { playerInRoom, scopedName, toRoom, useRoomScope, walkInRoom } from "../roomScope.ts";
import { type ClipboardLook, HardboardClipboardLook } from "./ClipboardLook.tsx";
import { clipboardAnchors, clipboardInReach } from "./clipboardAnchors.ts";
import {
  clipboardKey,
  clipboardSize,
  layoutClipboard,
  paintClipboard,
} from "./clipboardTexture.ts";

const NO_TASKS: readonly QueueTask[] = [];

function useClipboardTexture(w: number, h: number, tasks: readonly QueueTask[]) {
  const size = useMemo(() => clipboardSize(w, h), [w, h]);
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
  const layout = useMemo(() => layoutClipboard(tasks, size), [tasks, size]);
  const key = clipboardKey(layout);
  useEffect(() => {
    if (!surface.ctx) return;
    paintClipboard(surface.ctx, layout);
    surface.texture.needsUpdate = true;
    // `key` stands for `layout`: repaint only when the picture changes.
  }, [surface, key]);
  return surface.texture;
}

/** Open the panel, or queue the carried card. */
export function useClipboardAction(): () => void {
  const carried = useMyCarried();
  return useCallback(() => {
    const queue = useQueueStore.getState();
    if (carried) {
      dropCard();
      queue.openAdd(cardQueuePrefill(carried));
    } else queue.openPanel();
  }, [carried]);
}

function Clipboard({
  wall,
  anchor,
  tasks,
  inReach,
  dropTarget,
  onOpen,
  look: Look,
}: {
  wall: Wall;
  anchor: WallAnchor;
  tasks: readonly QueueTask[];
  inReach: boolean;
  dropTarget: boolean;
  onOpen: () => void;
  look: ClipboardLook;
}) {
  const scope = useRoomScope();
  const p = anchorPlacement(wall, anchor, scope.wallDepth);
  const texture = useClipboardTexture(anchor.w, anchor.h, tasks);
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
      name={scopedName(scope, `queue-${anchor.id}`)}
    >
      <Look
        w={anchor.w}
        h={anchor.h}
        texture={texture}
        highlighted={hover || inReach || (dropTarget && scope.interactive)}
      />
      {scope.interactive && (
        <mesh
          name={`queue-hotspot-${anchor.id}`}
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

export function QueueLayer({
  template,
  look = HardboardClipboardLook,
}: {
  template: RoomTemplate;
  look?: ClipboardLook;
}) {
  const scope = useRoomScope();
  const clipboards = useMemo(() => clipboardAnchors(template), [template]);
  const tasks = scope.store((s) => s.state?.queue ?? NO_TASKS);
  const carrying = useMyCarried() !== null;
  const act = useClipboardAction();
  const reachId = usePlayerStore((s) =>
    s.spawned && scope.interactive
      ? (clipboardInReach(clipboards, toRoom(scope, s))?.anchor.id ?? null)
      : null,
  );
  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || !scope.interactive) return;
        const player = playerInRoom(scope);
        if (!player.spawned || !clipboardInReach(clipboards, player)) return;
        detail.handled = true;
        act();
      },
      [clipboards, act, scope],
    ),
  );
  return (
    <group name={scopedName(scope, "queue")}>
      {clipboards.map((c) => (
        <Clipboard
          key={c.anchor.id}
          wall={c.wall}
          anchor={c.anchor}
          tasks={tasks}
          inReach={reachId === c.anchor.id}
          dropTarget={carrying}
          onOpen={() => {
            walkInRoom(scope, c.stand.x, c.stand.z);
            act();
          }}
          look={look}
        />
      ))}
    </group>
  );
}
