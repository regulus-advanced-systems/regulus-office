/**
 * The live contents of every joined room (#186, SPEC §9.1): henchmen at their
 * desks, laptops with their screens, the issue and PR boards, the queue
 * clipboard, the gong and the room's usage screen, drawn in the room's own
 * frame from its OperationRoom state (roomScope.ts). The room the player is in
 * is interactive and reads the operation store the HUD reads; the nearby rooms
 * are view-only. Rooms are drawn in the lair looks (#183).
 */
import { type RoomLayout, wallById } from "@regulus/room-layout";
import { memo, Suspense, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOperationStore } from "../../state/operation.ts";
import { roomOperationStore, useRoomsStore } from "../../state/rooms.ts";
import { BoardLayer } from "../boards/BoardLayer.tsx";
import { anchorPlacement } from "../furniture/placement.ts";
import { GongLayer } from "../gong/GongLayer.tsx";
import { HenchmanLayer } from "../henchmen/HenchmanLayer.tsx";
import { DepartingHenchmen } from "../henchmen/sendHome/DepartingHenchmen.tsx";
import { wallPieceFor } from "../lair/generatorModels.ts";
import { WALL_RELIEF } from "../lair/geometry/walls.ts";
import { LairBoardLook, LairClipboardLook, LairGongLook } from "../lair/looks/LairLooks.tsx";
import { LaptopLayer } from "../laptops/LaptopLayer.tsx";
import { QueueLayer } from "../queue/QueueClipboard.tsx";
import { type RoomScope, RoomScopeContext } from "../roomScope.ts";
import { UsageScreen } from "../usage/UsageScreen.tsx";
import { lairAnchors } from "./lairAnchors.ts";
import type { PlacedRoom } from "./placed.ts";

/** How far proud of the wall line wall-hung objects stand, as `anchorPlacement` depth. */
function wallDepth(layout: RoomLayout): number {
  const piece = wallPieceFor(layout.room.materials.wall);
  const relief =
    WALL_RELIEF[piece === "wall_rock" ? "rock" : piece === "wall_steel" ? "steel" : "concrete"];
  // anchorPlacement already stands 0.11 m off the line (half a 0.2 m template wall plus a gap).
  return Math.max(0, 2 * (relief + 0.02 - 0.11));
}

function UsageScreens({ layout, depth }: { layout: RoomLayout; depth: number }) {
  return (
    <>
      {layout.wallAnchors
        .filter((a) => a.kind === "usage_wall")
        .map((a) => {
          const wall = wallById(layout, a.wallId);
          if (!wall) return null;
          const p = anchorPlacement(wall, a, depth + 0.12);
          return (
            <group key={a.id} position={p.position} rotation-y={p.rotationY} name={a.id}>
              <UsageScreen w={a.w} h={a.h} />
            </group>
          );
        })}
    </>
  );
}

const JoinedRoom = memo(function JoinedRoom({
  placed,
  interactive,
}: {
  placed: PlacedRoom;
  interactive: boolean;
}) {
  const layout = placed.art.layout;
  const id = placed.room.id;
  const scope = useMemo<RoomScope | null>(
    () =>
      layout
        ? {
            operationId: id,
            origin: placed.room.origin,
            interactive,
            store: interactive ? useOperationStore : roomOperationStore(id),
            wallDepth: wallDepth(layout),
          }
        : null,
    [layout, id, placed.room.origin, interactive],
  );
  if (!layout || !scope) return null;
  return (
    <RoomScopeContext.Provider value={scope}>
      <group name={`room-${id}`} position={[placed.room.origin.x, 0, placed.room.origin.z]}>
        <Suspense fallback={null}>
          <HenchmanLayer template={layout} anchorsFor={lairAnchors} />
          <LaptopLayer template={layout} freeDesks={false} />
          <BoardLayer template={layout} look={LairBoardLook} carried={false} />
          <QueueLayer template={layout} look={LairClipboardLook} />
          <GongLayer template={layout} look={LairGongLook} />
          <UsageScreens layout={layout} depth={scope.wallDepth} />
          {interactive && <DepartingHenchmen template={layout} />}
        </Suspense>
      </group>
    </RoomScopeContext.Provider>
  );
});

export function RoomLayers({ rooms }: { rooms: readonly PlacedRoom[] }) {
  const joined = useRoomsStore(useShallow((s) => Object.keys(s.states).sort()));
  const current = useOperationStore((s) => s.operationId);
  const byId = useMemo(() => new Map(rooms.map((r) => [r.room.id, r])), [rooms]);
  return (
    <group name="room-layers">
      {joined.map((id) => {
        const placed = byId.get(id);
        if (!placed || placed.art.look !== "open") return null;
        return <JoinedRoom key={id} placed={placed} interactive={id === current} />;
      })}
    </group>
  );
}
