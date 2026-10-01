/**
 * The operation's issue and PR boards (SPEC §9.4; #36), one per `issue_board` /
 * `pr_board` wall anchor, painted from the OperationRoom's board summaries
 * (#35). A click, or `E` near one, opens its 2D panel (ui/boards). Also the
 * cards being carried around the operation (CarriedCards).
 */

import type { HenchmanState, IssueCard, PullCard, RepoSummary } from "@regulus/protocol";
import type { RoomTemplate } from "@regulus/room-layout";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlayerStore } from "../../state/player.ts";
import { useBoardStore } from "../../ui/boards/boardStore.ts";
import { buildBoard } from "../../ui/boards/columns.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { playerInRoom, scopedName, toRoom, useRoomScope, walkInRoom } from "../roomScope.ts";
import { BoardObject } from "./BoardObject.tsx";
import { boardAnchors, boardInReach } from "./boardAnchors.ts";
import { CarriedCards } from "./CarriedCards.tsx";
import type { BoardLook } from "./CorkBoardLook.tsx";

const NO_ISSUES: Readonly<Record<string, IssueCard>> = {};
const NO_PULLS: Readonly<Record<string, PullCard>> = {};
const NO_REPOS: readonly RepoSummary[] = [];
const NO_HENCHMEN: Readonly<Record<string, HenchmanState>> = {};

export interface BoardLayerProps {
  template: RoomTemplate;
  look?: BoardLook;
  /** Draw carried cards here (the compound draws them once, in world space). */
  carried?: boolean;
}

export function BoardLayer({ template, look, carried = true }: BoardLayerProps) {
  const scope = useRoomScope();
  const boards = useMemo(() => boardAnchors(template), [template]);
  const openBoard = useBoardStore((s) => s.openBoard);
  const state = scope.store(
    useShallow((s) => ({
      issues: s.state?.issues ?? NO_ISSUES,
      pulls: s.state?.pulls ?? NO_PULLS,
      repos: s.state?.repos ?? NO_REPOS,
      henchmen: s.state?.henchmen ?? NO_HENCHMEN,
    })),
  );
  const columns = useMemo(() => {
    const input = { ...state, henchmen: Object.values(state.henchmen) };
    return { issue: buildBoard("issue", input), pr: buildBoard("pr", input) };
  }, [state]);
  const reachId = usePlayerStore((s) =>
    s.spawned && scope.interactive
      ? (boardInReach(boards, toRoom(scope, s))?.anchor.id ?? null)
      : null,
  );

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || !scope.interactive) return;
        const player = playerInRoom(scope);
        if (!player.spawned) return;
        const board = boardInReach(boards, player);
        if (!board) return;
        detail.handled = true;
        openBoard(board.kind);
      },
      [boards, openBoard, scope],
    ),
  );

  return (
    <group name={scopedName(scope, "boards")}>
      {boards.map((b) => (
        <BoardObject
          key={b.anchor.id}
          wall={b.wall}
          anchor={b.anchor}
          columns={columns[b.kind]}
          inReach={reachId === b.anchor.id}
          onOpen={() => {
            // Walk over to the board while its panel is up, like a desk click.
            walkInRoom(scope, b.stand.x, b.stand.z);
            openBoard(b.kind);
          }}
          look={look}
        />
      ))}
      {carried && <CarriedCards />}
    </group>
  );
}
