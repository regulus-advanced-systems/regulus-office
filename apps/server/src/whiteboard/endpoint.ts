/**
 * The whiteboard sync endpoint (SPEC §6 channel 4, #45): `/ws/wb/<boardId>`,
 * the y-websocket protocol over the office's one `Bun.serve` (a `WsRoute`
 * next to the terminal bridge and the Colyseus rooms).
 *
 * Every upgrade is checked before a socket exists, like the OperationRoom
 * join and the screen feed: Origin (SPEC §11), the Better Auth session
 * cookie, then board access (./access.ts). A board the user cannot reach is
 * 404, so its existence is not revealed. One {@link LiveBoard} per board
 * lives while anyone is connected; the last one out saves it and frees it.
 */
import { WHITEBOARD_MAX_MESSAGE_BYTES, WHITEBOARD_WS_PREFIX } from "@regulus/protocol";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { checkOrigin, type OriginPolicy } from "../auth/origin.ts";
import type { WsRoute } from "../http/ws-router.ts";
import type { Logger } from "../logging.ts";
import { UPGRADED } from "../rooms/transport.ts";
import type { BoardAccessCheck, BoardUser } from "./access.ts";
import { type BoardPeer, LiveBoard } from "./board.ts";
import type { WhiteboardStore } from "./store.ts";

/** Route label for logs and metrics; the board id never goes into a label (#90). */
export const WHITEBOARD_ROUTE = `${WHITEBOARD_WS_PREFIX}:boardId`;

export interface WhiteboardSessionLookup {
  getSessionFromRequest(request: Request): Promise<BoardUser | null>;
}

export interface WhiteboardEndpointOptions {
  store: WhiteboardStore;
  sessions: WhiteboardSessionLookup;
  access: BoardAccessCheck;
  originPolicy: OriginPolicy;
  logger: Logger;
  saveDelayMs?: number;
  maxSaveDelayMs?: number;
  maxDocBytes?: number;
}

interface BoardSocketData {
  boardId: string;
  peer?: BoardPeer;
  user: BoardUser;
  writable: boolean;
}

const reject = (status: number, error: string): Response =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export class WhiteboardEndpoint implements WsRoute {
  readonly #opts: WhiteboardEndpointOptions;
  readonly #boards = new Map<string, LiveBoard>();

  constructor(options: WhiteboardEndpointOptions) {
    this.#opts = options;
  }

  routeOf(url: URL): string | undefined {
    return url.pathname.startsWith(WHITEBOARD_WS_PREFIX) ? WHITEBOARD_ROUTE : undefined;
  }

  /** The live board while someone is connected (tests, metrics). */
  live(boardId: string): LiveBoard | undefined {
    return this.#boards.get(boardId);
  }

  /** Save and close every live board (server shutdown). */
  shutdown(): void {
    for (const board of this.#boards.values()) board.destroy(1001, "server shutdown");
    this.#boards.clear();
  }

  fetch = async (
    request: Request,
    url: URL,
    server: Server<unknown>,
  ): Promise<Response | typeof UPGRADED | undefined> => {
    if (!url.pathname.startsWith(WHITEBOARD_WS_PREFIX)) return undefined;
    const log = this.#opts.logger.child({ route: WHITEBOARD_ROUTE });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return reject(426, "websocket_required");
    }
    const origin = checkOrigin(request, this.#opts.originPolicy.publicUrl, this.#opts.originPolicy);
    if (!origin.ok) {
      log.warn(
        { origin: origin.origin, reason: origin.reason },
        "rejected cross-origin whiteboard",
      );
      return reject(403, "origin_rejected");
    }
    const user = await this.#opts.sessions.getSessionFromRequest(request);
    if (!user) return reject(401, "unauthenticated");
    let boardId: string;
    try {
      boardId = decodeURIComponent(url.pathname.slice(WHITEBOARD_WS_PREFIX.length));
    } catch {
      return reject(404, "not_found");
    }
    const access = this.#opts.access(user, boardId);
    if (!access) {
      log.info({ userId: user.id }, "whiteboard denied");
      return reject(404, "not_found");
    }
    const data: BoardSocketData = { boardId, user, writable: access === "edit" };
    if (!server.upgrade(request, { data })) return reject(400, "upgrade_failed");
    return UPGRADED;
  };

  readonly websocket: WebSocketHandler<unknown> = {
    open: (ws) => this.#open(ws as ServerWebSocket<BoardSocketData>),
    message: (ws, message) => this.#message(ws as ServerWebSocket<BoardSocketData>, message),
    close: (ws) => this.#close(ws as ServerWebSocket<BoardSocketData>),
  };

  #board(boardId: string): LiveBoard {
    let board = this.#boards.get(boardId);
    if (board) return board;
    const { store, logger } = this.#opts;
    board = new LiveBoard({
      boardId,
      initial: store.load(boardId)?.ydoc ?? null,
      save: (state) => store.saveDoc(boardId, state),
      logger,
      saveDelayMs: this.#opts.saveDelayMs,
      maxSaveDelayMs: this.#opts.maxSaveDelayMs,
      maxDocBytes: this.#opts.maxDocBytes,
    });
    this.#boards.set(boardId, board);
    return board;
  }

  #open(ws: ServerWebSocket<BoardSocketData>): void {
    const { boardId, user, writable } = ws.data;
    const peer: BoardPeer = {
      userId: user.id,
      name: (user.displayName ?? user.id).slice(0, 64),
      writable,
      send: (data) => {
        ws.sendBinary(data);
      },
      close: (code, reason) => ws.close(code, reason),
    };
    ws.data.peer = peer;
    let board: LiveBoard;
    try {
      board = this.#board(boardId);
    } catch (err) {
      this.#opts.logger.error({ err }, "whiteboard load failed");
      ws.close(1011, "load failed");
      return;
    }
    board.add(peer);
  }

  #message(ws: ServerWebSocket<BoardSocketData>, message: string | Buffer): void {
    const { peer, boardId } = ws.data;
    const board = this.#boards.get(boardId);
    if (!peer || !board) return;
    if (typeof message === "string") return;
    if (message.byteLength > WHITEBOARD_MAX_MESSAGE_BYTES) {
      ws.close(1009, "message too big");
      return;
    }
    try {
      board.receive(peer, new Uint8Array(message.buffer, message.byteOffset, message.byteLength));
    } catch (err) {
      this.#opts.logger.warn({ err }, "malformed whiteboard message");
      ws.close(1003, "malformed message");
    }
  }

  #close(ws: ServerWebSocket<BoardSocketData>): void {
    const { peer, boardId } = ws.data;
    const board = this.#boards.get(boardId);
    if (!peer || !board) return;
    if (board.remove(peer)) {
      this.#boards.delete(boardId);
      board.destroy();
    }
  }
}
