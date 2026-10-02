/**
 * One live whiteboard (#45): a Y.Doc and its awareness, shared by every
 * socket on `/ws/wb/<boardId>`, speaking the y-websocket protocol
 * (y-protocols sync + awareness), so the stock `y-websocket` client works.
 *
 * - On connect the server sends sync step 1 and the current awareness; the
 *   client answers with what the server lacks (step 2) and asks for the rest,
 *   so a reconnecting client and the server converge both ways.
 * - Read-only peers (`view` access) get every update but their step 2 and
 *   update messages are dropped: nothing they send changes the document.
 * - Awareness (cursors, selection, name) is relayed for everyone, with the
 *   name rewritten to the session's display name so nobody can pose as
 *   someone else.
 * - Saving is debounced (`saveDelayMs` after the last change, at most
 *   `maxSaveDelayMs` after the first unsaved one) and forced when the last
 *   peer leaves; each save writes the whole merged document, so the stored
 *   blob never grows by more than the live content (no update log to compact).
 */
import { WHITEBOARD_FULL_CODE, WHITEBOARD_MAX_DOC_BYTES } from "@regulus/protocol";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { Logger } from "../logging.ts";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** A connected socket as the board sees it. */
export interface BoardPeer {
  readonly userId: string;
  readonly name: string;
  readonly writable: boolean;
  send(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

export interface LiveBoardOptions {
  boardId: string;
  /** The stored document, applied before the first peer syncs. */
  initial: Uint8Array | null;
  save: (state: Uint8Array) => void;
  logger: Logger;
  saveDelayMs?: number;
  maxSaveDelayMs?: number;
  maxDocBytes?: number;
}

export class LiveBoard {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly #opts: LiveBoardOptions;
  readonly #peers = new Map<BoardPeer, Set<number>>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #dirtySince = 0;
  /** Stored size plus every update applied since: an upper bound on the encoded size. */
  #bytes = 0;

  constructor(options: LiveBoardOptions) {
    this.#opts = options;
    if (options.initial) {
      Y.applyUpdate(this.doc, options.initial);
      this.#bytes = options.initial.byteLength;
    }
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    // The server has no cursor of its own.
    this.awareness.setLocalState(null);
    this.doc.on("update", (update: Uint8Array) => this.#onUpdate(update));
    this.awareness.on("update", this.#onAwareness);
  }

  get peerCount(): number {
    return this.#peers.size;
  }

  add(peer: BoardPeer): void {
    this.#peers.set(peer, new Set());
    const sync = encoding.createEncoder();
    encoding.writeVarUint(sync, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(sync, this.doc);
    peer.send(encoding.toUint8Array(sync));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      peer.send(
        awarenessMessage(
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
        ),
      );
    }
  }

  /** Remove a peer and its cursors; true when it was the last one. */
  remove(peer: BoardPeer): boolean {
    const clients = this.#peers.get(peer);
    if (!clients) return this.#peers.size === 0;
    this.#peers.delete(peer);
    if (clients.size > 0)
      awarenessProtocol.removeAwarenessStates(this.awareness, [...clients], null);
    return this.#peers.size === 0;
  }

  receive(peer: BoardPeer, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const kind = decoding.readVarUint(decoder);
    if (kind === MESSAGE_SYNC) this.#sync(peer, decoder);
    else if (kind === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      const named = awarenessProtocol.modifyAwarenessUpdate(update, (state) =>
        state && typeof state === "object"
          ? { ...state, user: { ...(isObject(state.user) ? state.user : {}), name: peer.name } }
          : state,
      );
      awarenessProtocol.applyAwarenessUpdate(this.awareness, named, peer);
    }
  }

  /** Write any unsaved change now. */
  flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#dirtySince === 0) return;
    this.#dirtySince = 0;
    const state = Y.encodeStateAsUpdate(this.doc);
    this.#bytes = state.byteLength;
    try {
      this.#opts.save(state);
    } catch (err) {
      this.#opts.logger.error({ err, boardId: this.#opts.boardId }, "whiteboard save failed");
    }
  }

  /** Flush, drop every peer and free the document. */
  destroy(code = 1001, reason = "board closed"): void {
    this.flush();
    for (const peer of [...this.#peers.keys()]) peer.close(code, reason);
    this.#peers.clear();
    this.awareness.destroy();
    this.doc.destroy();
  }

  #sync(peer: BoardPeer, decoder: decoding.Decoder): void {
    const type = decoding.readVarUint(decoder);
    if (type === syncProtocol.messageYjsSyncStep1) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncStep1(decoder, reply, this.doc);
      peer.send(encoding.toUint8Array(reply));
      return;
    }
    if (type !== syncProtocol.messageYjsSyncStep2 && type !== syncProtocol.messageYjsUpdate) return;
    // Read-only peers sync down only (D12: viewers watch, they do not draw).
    if (!peer.writable) return;
    const update = decoding.readVarUint8Array(decoder);
    const max = this.#opts.maxDocBytes ?? WHITEBOARD_MAX_DOC_BYTES;
    if (this.#bytes + update.byteLength > max) {
      this.#bytes = Y.encodeStateAsUpdate(this.doc).byteLength;
      if (this.#bytes + update.byteLength > max) {
        this.#opts.logger.warn({ boardId: this.#opts.boardId }, "whiteboard full; edit refused");
        peer.close(WHITEBOARD_FULL_CODE, "board full");
        return;
      }
    }
    try {
      Y.applyUpdate(this.doc, update, peer);
    } catch (err) {
      this.#opts.logger.warn({ err, boardId: this.#opts.boardId }, "bad whiteboard update");
    }
  }

  #onUpdate(update: Uint8Array): void {
    this.#bytes += update.byteLength;
    const message = encoding.createEncoder();
    encoding.writeVarUint(message, MESSAGE_SYNC);
    syncProtocol.writeUpdate(message, update);
    const bytes = encoding.toUint8Array(message);
    for (const peer of this.#peers.keys()) peer.send(bytes);
    this.#scheduleSave();
  }

  #scheduleSave(): void {
    const now = Date.now();
    if (this.#dirtySince === 0) this.#dirtySince = now;
    if (this.#timer) clearTimeout(this.#timer);
    const delay = this.#opts.saveDelayMs ?? 1000;
    const latest = this.#dirtySince + (this.#opts.maxSaveDelayMs ?? 5000);
    this.#timer = setTimeout(() => this.flush(), Math.max(0, Math.min(delay, latest - now)));
  }

  readonly #onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const owned = origin ? this.#peers.get(origin as BoardPeer) : undefined;
    if (owned) {
      for (const id of added) owned.add(id);
      for (const id of removed) owned.delete(id);
    }
    const changed = [...added, ...updated, ...removed];
    const bytes = awarenessMessage(
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
    );
    for (const peer of this.#peers.keys()) peer.send(bytes);
  };
}

function awarenessMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
