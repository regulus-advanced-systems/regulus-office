/**
 * The Yjs provider for one whiteboard (SPEC §4.3 `net/`, §6 channel 4; #45):
 * a Y.Doc synced over `/ws/wb/<boardId>` with the stock y-websocket client,
 * which reconnects with backoff and resyncs both ways on reconnect. The
 * awareness carries this human's cursor, selection and name (the server
 * rewrites the name to the session's). Only the lazily loaded editor imports
 * this module, so Yjs stays out of the main bundle.
 */
import {
  WHITEBOARD_FULL_CODE,
  WHITEBOARD_Y_ASSETS,
  WHITEBOARD_Y_ELEMENTS,
  whiteboardWsBase,
} from "@regulus/protocol";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { officeServerUrl, toWebSocketUrl } from "./serverUrl.ts";

export interface BoardSync {
  doc: Y.Doc;
  provider: WebsocketProvider;
  elements: Y.Array<Y.Map<unknown>>;
  assets: Y.Map<unknown>;
  destroy(): void;
}

export interface BoardSyncOptions {
  /** ws(s) origin of the office; defaults to the page's. */
  wsOrigin?: string;
  WebSocketPolyfill?: typeof WebSocket;
}

export function openBoardSync(
  boardId: string,
  user: { name: string; color: string },
  options: BoardSyncOptions = {},
): BoardSync {
  const doc = new Y.Doc();
  const base = whiteboardWsBase(options.wsOrigin ?? toWebSocketUrl(officeServerUrl()));
  const provider = new WebsocketProvider(base, encodeURIComponent(boardId), doc, {
    maxBackoffTime: 10_000,
    // A board that is full refuses edits for good; reconnecting would not help.
    shouldReconnect: (event) => event.code !== WHITEBOARD_FULL_CODE,
    ...(options.WebSocketPolyfill ? { WebSocketPolyfill: options.WebSocketPolyfill } : {}),
  });
  provider.awareness.setLocalStateField("user", user);
  return {
    doc,
    provider,
    elements: doc.getArray<Y.Map<unknown>>(WHITEBOARD_Y_ELEMENTS),
    assets: doc.getMap<unknown>(WHITEBOARD_Y_ASSETS),
    destroy() {
      provider.destroy();
      doc.destroy();
    },
  };
}
