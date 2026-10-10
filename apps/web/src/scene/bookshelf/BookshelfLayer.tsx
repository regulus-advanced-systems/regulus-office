/**
 * The room's bookshelf in the scene (SPEC §9.4; #264). The shelf itself is
 * furniture: the room generator places it and the lair kit draws it (the
 * existing shelving piece, so the kit's triangle budget is untouched). This
 * layer only makes it usable in the room the player is in: a click walks
 * over and opens the reader, `E` opens it from the spot in front, and a
 * brass outline shows while `E` would open it or the cursor is on it.
 *
 * `E` arrives as the `interact` hotkey event, which the registry does not
 * send while a terminal, a text field or the whiteboard has the keyboard.
 * When the press is the shelf's (shelfSpot.ts: in reach, and no desk seat
 * nearer), the shelf answers first and alone: it listens in the capture
 * phase, which runs before the other layers' listeners, and stops the event
 * there, so a desk a little further off does not open its terminal as well.
 */
import type { ThreeEvent } from "@react-three/fiber";
import type { RoomTemplate } from "@regulus/room-layout";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayerStore } from "../../state/player.ts";
import { useBookshelfStore } from "../../ui/bookshelf/bookshelfStore.ts";
import { HOTKEY_EVENT, type HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { playerInRoom, type RoomScope, toRoom, useRoomScope, walkInRoom } from "../roomScope.ts";
import { SHELF_HEIGHT, type ShelfSpot, shelfSpot, shelfTakesE } from "./shelfSpot.ts";

/**
 * Open the shelf on an `interact` press that is the shelf's, before any
 * other listener hears it. Returns the remover.
 */
export function listenForShelfE(
  target: EventTarget,
  spot: ShelfSpot,
  playerAt: () => { x: number; z: number; spawned: boolean },
  open: () => void,
): () => void {
  const on = (event: Event) => {
    const detail = (event as CustomEvent<HotkeyEventDetail>).detail;
    if (detail?.id !== "interact" || detail.handled) return;
    const player = playerAt();
    if (!player.spawned || !shelfTakesE(spot, player)) return;
    detail.handled = true;
    event.stopImmediatePropagation();
    open();
  };
  target.addEventListener(HOTKEY_EVENT, on, { capture: true });
  return () => target.removeEventListener(HOTKEY_EVENT, on, { capture: true });
}

function useShelfE(scope: RoomScope, spot: ShelfSpot | null, usable: boolean, open: () => void) {
  useEffect(() => {
    if (!usable || !spot) return;
    return listenForShelfE(window, spot, () => playerInRoom(scope), open);
  }, [usable, spot, scope, open]);
}

export function BookshelfLayer({ template }: { template: RoomTemplate }) {
  const scope = useRoomScope();
  const spot = useMemo(() => shelfSpot(template), [template]);
  const [hover, setHover] = useState(false);
  const usable = scope.interactive && scope.operationId !== null && spot !== null;
  const inReach = usePlayerStore((s) => usable && s.spawned && shelfTakesE(spot, toRoom(scope, s)));
  const open = useCallback(() => {
    if (scope.operationId) useBookshelfStore.getState().openShelf(scope.operationId);
  }, [scope.operationId]);
  useShelfE(scope, spot, usable, open);

  if (!usable || !spot) return null;
  const { rect } = spot;
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    walkInRoom(scope, spot.stand.x, spot.stand.z);
    open();
  };
  return (
    <group
      name="docs-shelf"
      position={[rect.x + rect.w / 2, SHELF_HEIGHT / 2, rect.z + rect.d / 2]}
    >
      <mesh
        name="docs-shelf-hotspot"
        // Hit target only: invisible objects still take pointer events but cost no draw call.
        visible={false}
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
        <boxGeometry args={[rect.w + 0.1, SHELF_HEIGHT, rect.d + 0.1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {(hover || inReach) && (
        <mesh name="docs-shelf-highlight">
          <boxGeometry args={[rect.w + 0.06, SHELF_HEIGHT + 0.04, rect.d + 0.06]} />
          <meshBasicMaterial color="#C9A227" wireframe toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
