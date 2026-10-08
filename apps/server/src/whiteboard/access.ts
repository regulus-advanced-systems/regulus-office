/**
 * Who reaches which board (#45, D12, SPEC §8, §11): an operation's board with
 * the same check as its OperationRoom join (operations/access.ts: live
 * operation, the person's own GitHub access to its repo), read-only for `view` access
 * and office viewers; the lobby board for every signed-in human, read-only
 * for viewers. Board ids are the operation id or `LOBBY_WHITEBOARD_ID`.
 */
import {
  LOBBY_WHITEBOARD_ID,
  type UserRole,
  type WhiteboardAccess,
  whiteboardAccessFor,
} from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import { operationAccessFor } from "../operations/access.ts";

/** Same shape the terminal ids use: operation ids are UUIDs, the lobby is `lobby`. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface BoardUser {
  id: string;
  role: UserRole;
  displayName?: string;
  /** The Better Auth session behind the request (live access, #244). */
  sessionId?: string;
}

export type BoardAccessCheck = (user: BoardUser, boardId: string) => WhiteboardAccess | null;

export function dbBoardAccess(db: Db): BoardAccessCheck {
  return (user, boardId) => {
    if (!BOARD_ID_PATTERN.test(boardId)) return null;
    const operation =
      boardId === LOBBY_WHITEBOARD_ID
        ? null
        : operationAccessFor(db, { id: user.id, role: user.role }, boardId);
    return whiteboardAccessFor(boardId, user.role, operation);
  };
}
