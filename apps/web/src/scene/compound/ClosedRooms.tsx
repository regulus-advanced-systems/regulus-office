/**
 * Closed rooms in the scene (SPEC §14 D26; #269): the neutral "no entry"
 * plate on every visible closed room (one shared texture, one plane each),
 * and the answer to trying to go in: a click on the room, or `E` at its door
 * or plate, gets the plain "no entry" notice (state/entry.ts). The rock, the
 * barred door and the cap are kit pieces (interiors.ts, RoomMarkers.tsx).
 * Nothing here knows anything about the room but its footprint.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo } from "react";
import { Euler } from "three";
import { refuseEntry } from "../../state/entry.ts";
import { usePlayerStore } from "../../state/player.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { WALL_HEIGHT } from "../lair/dimensions.ts";
import { closedRoomAt, closedRooms, PLATE, PLATE_TILT, platePose } from "./closed.ts";
import { createNoEntryTexture } from "./signTexture.ts";
import type { CompoundWorld } from "./world.ts";

export function ClosedRooms({
  world,
  visible,
}: {
  world: CompoundWorld;
  visible: ReadonlySet<string>;
}) {
  const rooms = useMemo(
    () => closedRooms(world).map((room) => ({ room, pose: platePose(room, world) })),
    [world],
  );
  const texture = useMemo(() => (rooms.length > 0 ? createNoEntryTexture() : null), [rooms.length]);
  useEffect(() => () => texture?.dispose(), [texture]);

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled) return;
        const p = usePlayerStore.getState();
        if (!p.spawned || !closedRoomAt(world, p)) return;
        detail.handled = true;
        refuseEntry();
      },
      [world],
    ),
  );

  if (rooms.length === 0) return null;
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    // The click does not become a walk into the rock.
    event.stopPropagation();
    refuseEntry();
  };
  return (
    <group name="closed-rooms">
      {rooms
        .filter(({ room }) => visible.has(room.id))
        .map(({ room, pose }) => (
          <group key={room.id}>
            <mesh
              name={`no-entry-plate-${room.id}`}
              position={pose.position}
              rotation={new Euler(-PLATE_TILT, pose.yaw, 0, "YXZ")}
              raycast={() => null}
            >
              <planeGeometry args={[PLATE.w, PLATE.h]} />
              <meshBasicMaterial map={texture} toneMapped={false} />
            </mesh>
            <mesh
              name={`closed-room-${room.id}`}
              // Hit target only: invisible objects still take pointer events but cost no draw call.
              visible={false}
              position={[
                room.origin.x + room.size.w / 2,
                WALL_HEIGHT / 2,
                room.origin.z + room.size.d / 2,
              ]}
              onClick={click}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "not-allowed";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "";
              }}
            >
              <boxGeometry args={[room.size.w, WALL_HEIGHT, room.size.d]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>
          </group>
        ))}
    </group>
  );
}
