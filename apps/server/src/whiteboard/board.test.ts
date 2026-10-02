/**
 * LiveBoard without sockets (#45): debounced saves, a forced save on flush,
 * the document size cap, and a stored document loaded on start.
 */
import { expect, test } from "bun:test";
import { WHITEBOARD_FULL_CODE } from "@regulus/protocol";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { createLogger } from "../logging.ts";
import { type BoardPeer, LiveBoard, MESSAGE_SYNC } from "./board.ts";

const logger = createLogger({ level: "silent" });

function peer(writable = true): BoardPeer & { closed: number[]; sent: number } {
  const p = {
    userId: "u",
    name: "U",
    writable,
    closed: [] as number[],
    sent: 0,
    send: () => {
      p.sent += 1;
    },
    close: (code: number) => {
      p.closed.push(code);
    },
  };
  return p;
}

/** A sync `update` message carrying one new element. */
function updateMessage(id: string, text = ""): Uint8Array {
  const doc = new Y.Doc();
  const entry = new Y.Map<unknown>();
  entry.set("el", { id, text });
  doc.getArray("elements").push([entry]);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
  return encoding.toUint8Array(encoder);
}

test("saves once after a burst of edits, and again on flush only when dirty", async () => {
  const saves: Uint8Array[] = [];
  const board = new LiveBoard({
    boardId: "b",
    initial: null,
    save: (s) => saves.push(s),
    logger,
    saveDelayMs: 30,
    maxSaveDelayMs: 1000,
  });
  const p = peer();
  board.add(p);
  board.receive(p, updateMessage("a"));
  board.receive(p, updateMessage("b"));
  expect(saves).toHaveLength(0);
  await Bun.sleep(80);
  expect(saves).toHaveLength(1);
  board.flush();
  expect(saves).toHaveLength(1);
  board.receive(p, updateMessage("c"));
  board.flush();
  expect(saves).toHaveLength(2);
  const restored = new LiveBoard({
    boardId: "b",
    initial: saves[1] ?? null,
    save: () => {},
    logger,
  });
  expect(restored.doc.getArray("elements").length).toBe(3);
  board.destroy();
  restored.destroy();
});

test("a busy board is saved at least every maxSaveDelayMs", async () => {
  const saves: Uint8Array[] = [];
  const board = new LiveBoard({
    boardId: "b",
    initial: null,
    save: (s) => saves.push(s),
    logger,
    saveDelayMs: 40,
    maxSaveDelayMs: 60,
  });
  const p = peer();
  board.add(p);
  for (let i = 0; i < 6; i++) {
    board.receive(p, updateMessage(`e${i}`));
    await Bun.sleep(20);
  }
  expect(saves.length).toBeGreaterThanOrEqual(1);
  board.destroy();
});

test("an edit that would overflow the board closes the editor and is dropped", () => {
  const board = new LiveBoard({
    boardId: "b",
    initial: null,
    save: () => {},
    logger,
    maxDocBytes: 400,
  });
  const p = peer();
  board.add(p);
  board.receive(p, updateMessage("small"));
  board.receive(p, updateMessage("big", "x".repeat(1000)));
  expect(p.closed).toEqual([WHITEBOARD_FULL_CODE]);
  expect(board.doc.getArray("elements").length).toBe(1);
  board.destroy();
});

test("read-only peers' updates are ignored", () => {
  const board = new LiveBoard({ boardId: "b", initial: null, save: () => {}, logger });
  const p = peer(false);
  board.add(p);
  board.receive(p, updateMessage("x"));
  expect(board.doc.getArray("elements").length).toBe(0);
  board.destroy();
});
