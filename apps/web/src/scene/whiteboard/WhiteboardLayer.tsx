/**
 * Whiteboards in the compound (#45): a room's board on its `whiteboard` wall
 * anchor, drawn from that room's OperationRoom state (snapshot version), and
 * the compound-wide board in the lobby, drawn from the BuildingRoom state.
 * A click walks over and opens the full-screen editor; `E` in reach opens it.
 * Only the room the player is in is interactive; nearby rooms show their
 * snapshot only.
 */
import { LOBBY_WHITEBOARD_ID } from "@regulus/protocol";
import type { RoomTemplate } from "@regulus/room-layout";
import { useCallback, useMemo } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { usePlayerStore } from "../../state/player.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { useWhiteboardStore } from "../../ui/whiteboard/whiteboardStore.ts";
import { anchorPlacement } from "../furniture/placement.ts";
import { playerInRoom, scopedName, toRoom, useRoomScope, walkInRoom } from "../roomScope.ts";
import { WhiteboardObject } from "./WhiteboardObject.tsx";
import { nearestInReach, whiteboardAnchors } from "./whiteboardAnchors.ts";

/** `E` near one of `stands` opens `boardId`. */
function useInteract(
  enabled: boolean,
  stands: readonly { stand: { x: number; z: number } }[],
  where: () => { x: number; z: number; spawned: boolean },
  open: () => void,
) {
  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled || !enabled) return;
        const p = where();
        if (!p.spawned || !nearestInReach(stands, p)) return;
        detail.handled = true;
        open();
      },
      [enabled, stands, where, open],
    ),
  );
}

/** The whiteboard of the operation room in scope (RoomScope). */
export function WhiteboardLayer({ template }: { template: RoomTemplate }) {
  const scope = useRoomScope();
  const boards = useMemo(() => whiteboardAnchors(template), [template]);
  const boardId = scope.operationId ?? "";
  const version = scope.store((s) => s.state?.whiteboardVersion ?? 0);
  const title = scope.store((s) => s.state?.name ?? "");
  const openBoard = useWhiteboardStore((s) => s.openBoard);
  const reachId = usePlayerStore((s) =>
    s.spawned && scope.interactive
      ? (nearestInReach(boards, toRoom(scope, s))?.anchor.id ?? null)
      : null,
  );
  const open = useCallback(() => openBoard(boardId, title), [openBoard, boardId, title]);
  const where = useCallback(() => playerInRoom(scope), [scope]);
  useInteract(scope.interactive && boardId !== "", boards, where, open);
  if (!boardId) return null;
  return (
    <group name={scopedName(scope, "whiteboards")}>
      {boards.map((b) => {
        const p = anchorPlacement(b.wall, b.anchor, scope.wallDepth);
        return (
          <WhiteboardObject
            key={b.anchor.id}
            name={scopedName(scope, `whiteboard-${b.anchor.id}`)}
            boardId={boardId}
            version={version}
            w={b.anchor.w}
            h={b.anchor.h}
            position={p.position}
            rotationY={p.rotationY}
            interactive={scope.interactive}
            inReach={reachId === b.anchor.id}
            onOpen={() => {
              walkInRoom(scope, b.stand.x, b.stand.z);
              open();
            }}
          />
        );
      })}
    </group>
  );
}

export interface LobbyBoardPlacement {
  position: readonly [number, number, number];
  rotationY: number;
  w: number;
  h: number;
  /** Compound metres. */
  stand: { x: number; z: number };
}

/** The compound-wide board on the lobby wall (compound metres). */
export function LobbyWhiteboard({ board }: { board: LobbyBoardPlacement }) {
  const version = useBuildingStore((s) => s.state?.lobbyWhiteboardVersion ?? 0);
  const openBoard = useWhiteboardStore((s) => s.openBoard);
  const stands = useMemo(() => [{ stand: board.stand }], [board.stand]);
  const inReach = usePlayerStore(
    (s) => s.spawned && nearestInReach(stands, { x: s.x, z: s.z }) !== null,
  );
  const open = useCallback(() => openBoard(LOBBY_WHITEBOARD_ID, "Lobby"), [openBoard]);
  const where = useCallback(() => usePlayerStore.getState(), []);
  useInteract(true, stands, where, open);
  return (
    <WhiteboardObject
      name="lobby-whiteboard"
      boardId={LOBBY_WHITEBOARD_ID}
      version={version}
      w={board.w}
      h={board.h}
      position={board.position}
      rotationY={board.rotationY}
      interactive
      inReach={inReach}
      onOpen={() => {
        usePlayerStore.getState().setTarget(board.stand.x, board.stand.z);
        open();
      }}
    />
  );
}
