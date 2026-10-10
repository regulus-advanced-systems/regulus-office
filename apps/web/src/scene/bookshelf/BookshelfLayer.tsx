/**
 * The room's bookshelf in the scene (SPEC §9.4; #264). The shelf itself is
 * furniture: the room generator places it and the lair kit draws it (the
 * existing shelving piece, so the kit's triangle budget is untouched). This
 * layer only makes it usable in the room the player is in: a click walks
 * over and opens the reader, `E` opens it from the spot in front, and a
 * brass outline shows while it is in reach or under the cursor.
 *
 * `E` arrives as the `interact` hotkey event, which the registry does not
 * send while a terminal, a text field or the whiteboard has the keyboard,
 * and which a board, the clipboard or the gong in reach has already taken.
 */
import type { ThreeEvent } from "@react-three/fiber";
import type { RoomTemplate } from "@regulus/room-layout";
import { useCallback, useMemo, useState } from "react";
import { usePlayerStore } from "../../state/player.ts";
import { useBookshelfStore } from "../../ui/bookshelf/bookshelfStore.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { playerInRoom, toRoom, useRoomScope, walkInRoom } from "../roomScope.ts";
import { SHELF_HEIGHT, shelfInReach, shelfSpot } from "./shelfSpot.ts";

export function BookshelfLayer({ template }: { template: RoomTemplate }) {
  const scope = useRoomScope();
  const spot = useMemo(() => shelfSpot(template), [template]);
  const [hover, setHover] = useState(false);
  const usable = scope.interactive && scope.operationId !== null && spot !== null;
  const inReach = usePlayerStore(
    (s) => usable && s.spawned && shelfInReach(spot, toRoom(scope, s)),
  );
  const open = useCallback(() => {
    if (scope.operationId) useBookshelfStore.getState().openShelf(scope.operationId);
  }, [scope.operationId]);

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled || !usable) return;
        const player = playerInRoom(scope);
        if (!player.spawned || !shelfInReach(spot, player)) return;
        detail.handled = true;
        open();
      },
      [usable, spot, scope, open],
    ),
  );

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
