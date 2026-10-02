/**
 * The shared whiteboard (SPEC §4.2, §6 channel 4, §9.4; #45): Excalidraw
 * synced with Yjs over `/ws/wb/<boardId>`, persisted by the server, shown on
 * the wall as a PNG snapshot the editing clients upload.
 *
 * Boards are keyed by operation id: one per operation (its room's whiteboard
 * anchor), plus the compound-wide board in the lobby under the reserved id
 * {@link LOBBY_WHITEBOARD_ID} (the lobby is not an `operations` row; the
 * server stores it as the `whiteboards` row with a null `operation_id`).
 *
 * Who may do what (D12, SPEC §8): an operation's board is reachable only by
 * people with access to that operation, exactly like its OperationRoom;
 * `view` access (and every office `viewer`) gets a read-only board. The
 * lobby board is open to every signed-in human, read-only for viewers.
 */
import { z } from "zod";
import type { OperationAccess, UserRole } from "./enums.ts";
import { LOBBY_OPERATION_ID } from "./rooms.ts";

/** Path prefix of the Yjs endpoint; the board id follows it. */
export const WHITEBOARD_WS_PREFIX = "/ws/wb/";

/** The compound-wide board in the lobby (the lobby's reserved operation id). */
export const LOBBY_WHITEBOARD_ID = LOBBY_OPERATION_ID;

/** Names of the shared types in a board's Y.Doc (the y-excalidraw layout). */
export const WHITEBOARD_Y_ELEMENTS = "elements";
export const WHITEBOARD_Y_ASSETS = "assets";

/** Editing clients render and upload the wall snapshot at most this often (SPEC research 01 §7). */
export const WHITEBOARD_SNAPSHOT_THROTTLE_MS = 2000;

/** Longest side of the uploaded snapshot, pixels. */
export const WHITEBOARD_SNAPSHOT_MAX_PX = 1600;

/** Largest snapshot PNG the server accepts. */
export const WHITEBOARD_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;

/** Largest single Yjs message (an image dropped on the board is one message). */
export const WHITEBOARD_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/** A board whose encoded document passes this refuses further edits. */
export const WHITEBOARD_MAX_DOC_BYTES = 32 * 1024 * 1024;

/** Close code sent when a board refuses an edit that would overflow it. */
export const WHITEBOARD_FULL_CODE = 4413;

export type WhiteboardAccess = "edit" | "view";

/** The access a human has on a board, from their office role and operation access. */
export function whiteboardAccessFor(
  boardId: string,
  role: UserRole,
  operationAccess: OperationAccess | null,
): WhiteboardAccess | null {
  if (boardId === LOBBY_WHITEBOARD_ID) return role === "viewer" ? "view" : "edit";
  if (!operationAccess) return null;
  return operationAccess === "view" || role === "viewer" ? "view" : "edit";
}

/** Base URL for `y-websocket` (`new WebsocketProvider(base, encodeURIComponent(boardId))`). */
export function whiteboardWsBase(wsOrigin: string): string {
  return `${wsOrigin.replace(/\/+$/, "")}${WHITEBOARD_WS_PREFIX.replace(/\/$/, "")}`;
}

/** `/ws/wb/<boardId>`. */
export function whiteboardWsPath(boardId: string): string {
  return `${WHITEBOARD_WS_PREFIX}${encodeURIComponent(boardId)}`;
}

/** REST: `GET` board info. */
export function whiteboardApiPath(boardId: string): string {
  return `/api/whiteboards/${encodeURIComponent(boardId)}`;
}

/** REST: `GET` the wall snapshot PNG (cache-busted by version), `PUT` a new one. */
export function whiteboardSnapshotPath(boardId: string, version?: number): string {
  const base = `${whiteboardApiPath(boardId)}/snapshot`;
  return version === undefined ? base : `${base}?v=${version}`;
}

/** `GET /api/whiteboards/:boardId`. */
export const WhiteboardInfo = z.object({
  boardId: z.string().min(1).max(128),
  /** Snapshot version; 0 while the board has never been drawn on. */
  version: z.number().int().nonnegative(),
  access: z.enum(["edit", "view"]),
});
export type WhiteboardInfo = z.infer<typeof WhiteboardInfo>;

/** `PUT /api/whiteboards/:boardId/snapshot` (body: the PNG). */
export const WhiteboardSnapshotResponse = z.object({
  version: z.number().int().nonnegative(),
});
export type WhiteboardSnapshotResponse = z.infer<typeof WhiteboardSnapshotResponse>;
