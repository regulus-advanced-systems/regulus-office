/**
 * WebSocket relay for the services proxy (#39): the upstream socket (the
 * app's, e.g. Vite HMR) is opened first, with the same cleaned headers as
 * HTTP; only then is the browser's upgrade accepted, with the subprotocol the
 * app chose. Frames are relayed both ways for the henchman's owner; for a
 * watcher only app-to-browser frames pass (the terminal's watch mode, D12).
 * {@link endRelay} cuts a relay whose human lost the app (live access, #244).
 */
import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { AppAccess } from "./access.ts";

type Frame = string | ArrayBuffer | Uint8Array;

export interface RelayData {
  upstream: WebSocket;
  access: AppAccess;
  /** App frames that arrived before the browser's socket opened. */
  early: Frame[];
  client?: ServerWebSocket<RelayData>;
  /** Set once the office ended the relay: nothing more passes either way. */
  ended?: { code: number; reason: string };
  /** Stop live access tracking. */
  release?: () => void;
}

/** End a relay from the office's side: no more frames, then both sockets close. */
export function endRelay(data: RelayData, code: number, reason: string): void {
  if (data.ended) return;
  data.ended = { code, reason };
  data.early.length = 0;
  const up = data.upstream;
  if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING) {
    up.close(1000, "viewer left");
  }
  // Before the browser's socket opened, `open` below closes it with the same code.
  data.client?.close(code, reason);
}

/** Bytes queued for the browser above which the relay gives up (a stuck tab). */
export const MAX_BUFFERED = 16 * 1024 * 1024;
const OPEN_TIMEOUT_MS = 10_000;

/** A close code a peer may send: 1000 or an application code. */
export function sendableCode(code: number | undefined): number {
  return code === 1000 || (code !== undefined && code >= 3000 && code <= 4999) ? code : 1000;
}

/** Open the app's socket; resolves once it is open, with the frames it sent meanwhile. */
export function openUpstream(
  url: string,
  headers: Headers,
  protocols: string[],
  access: AppAccess,
): Promise<RelayData> {
  return new Promise((resolve, reject) => {
    const init = { headers: Object.fromEntries(headers), protocols };
    // Bun's client takes headers in the options object.
    const upstream = new WebSocket(url, init as unknown as string[]);
    upstream.binaryType = "arraybuffer";
    const data: RelayData = { upstream, access, early: [] };
    const timer = setTimeout(() => {
      upstream.close();
      reject(new Error("upstream WebSocket timed out"));
    }, OPEN_TIMEOUT_MS);
    upstream.onmessage = (e) => {
      const frame = e.data as Frame;
      if (data.ended) return;
      if (data.client) send(data.client, frame);
      else data.early.push(frame);
    };
    upstream.onopen = () => {
      clearTimeout(timer);
      resolve(data);
    };
    upstream.onerror = () => {
      clearTimeout(timer);
      reject(new Error("upstream WebSocket failed"));
    };
    upstream.onclose = (e) => {
      clearTimeout(timer);
      if (!data.ended) data.client?.close(sendableCode(e.code), e.reason.slice(0, 120));
    };
  });
}

function send(client: ServerWebSocket<RelayData>, frame: Frame): void {
  if (client.getBufferedAmount() > MAX_BUFFERED) {
    client.close(1009, "too slow");
    client.data.upstream.close();
    return;
  }
  client.send(frame);
}

/** The Bun handler for relayed sockets (routed by http/ws-router.ts). */
export const relayHandler: WebSocketHandler<RelayData> = {
  open(ws) {
    ws.data.client = ws;
    if (ws.data.ended) {
      ws.close(ws.data.ended.code, ws.data.ended.reason);
      return;
    }
    for (const frame of ws.data.early.splice(0)) send(ws, frame);
    if (ws.data.upstream.readyState !== WebSocket.OPEN) ws.close(1000, "app closed");
  },
  message(ws, message) {
    // A watcher sees the app's frames but sends nothing into another human's sandbox.
    if (ws.data.ended || ws.data.access !== "control") return;
    if (ws.data.upstream.readyState === WebSocket.OPEN) ws.data.upstream.send(message);
  },
  close(ws, code, reason) {
    ws.data.release?.();
    const up = ws.data.upstream;
    if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING) {
      up.close(sendableCode(code), reason.slice(0, 120));
    }
  },
};
