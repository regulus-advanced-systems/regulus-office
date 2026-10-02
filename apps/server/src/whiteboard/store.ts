/**
 * Whiteboard rows (SPEC §5 `whiteboards`): one per operation, plus the lobby's
 * compound-wide board, stored as the row whose `operation_id` is null (the
 * lobby is not an `operations` row; its board id on the wire is the reserved
 * `LOBBY_WHITEBOARD_ID`). The Yjs document is kept as one compacted blob
 * (`Y.encodeStateAsUpdate` of the merged document, rewritten on every save);
 * the wall snapshot PNG lives on disk and the row holds its file name and a
 * version that bumps on every new snapshot.
 */
import { LOBBY_WHITEBOARD_ID } from "@regulus/protocol";
import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { whiteboards } from "../db/schema/index.ts";

export interface WhiteboardRecord {
  /** Encoded Yjs state, or null for a board nobody has drawn on. */
  ydoc: Uint8Array | null;
  /** Snapshot file name under the snapshot dir, or null. */
  snapshotPng: string | null;
  version: number;
}

const keyOf = (boardId: string) =>
  boardId === LOBBY_WHITEBOARD_ID
    ? isNull(whiteboards.operationId)
    : eq(whiteboards.operationId, boardId);

export class WhiteboardStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  load(boardId: string): WhiteboardRecord | null {
    const row = this.#db
      .select({
        ydoc: whiteboards.ydocBlob,
        snapshotPng: whiteboards.snapshotPng,
        version: whiteboards.version,
      })
      .from(whiteboards)
      .where(keyOf(boardId))
      .get();
    if (!row) return null;
    return {
      ydoc: row.ydoc ? new Uint8Array(row.ydoc) : null,
      snapshotPng: row.snapshotPng,
      version: row.version,
    };
  }

  /** Replace the stored document. */
  saveDoc(boardId: string, state: Uint8Array): void {
    this.#upsert(boardId, { ydocBlob: Buffer.from(state) });
  }

  /** Record a new snapshot file; returns the new version. */
  saveSnapshot(boardId: string, fileName: string): number {
    return this.#db.transaction((tx) => {
      const row = tx
        .select({ id: whiteboards.id, version: whiteboards.version })
        .from(whiteboards)
        .where(keyOf(boardId))
        .get();
      const version = (row?.version ?? 0) + 1;
      if (row) {
        tx.update(whiteboards)
          .set({ snapshotPng: fileName, version })
          .where(eq(whiteboards.id, row.id))
          .run();
      } else {
        tx.insert(whiteboards)
          .values({ operationId: operationIdOf(boardId), snapshotPng: fileName, version })
          .run();
      }
      return version;
    });
  }

  /** Snapshot file names still referenced (for pruning orphans on boot). */
  snapshotFiles(): Set<string> {
    const rows = this.#db.select({ file: whiteboards.snapshotPng }).from(whiteboards).all();
    return new Set(rows.flatMap((r) => (r.file ? [r.file] : [])));
  }

  #upsert(boardId: string, values: { ydocBlob: Buffer }): void {
    this.#db.transaction((tx) => {
      const row = tx.select({ id: whiteboards.id }).from(whiteboards).where(keyOf(boardId)).get();
      if (row) tx.update(whiteboards).set(values).where(eq(whiteboards.id, row.id)).run();
      else
        tx.insert(whiteboards)
          .values({ operationId: operationIdOf(boardId), ...values })
          .run();
    });
  }
}

const operationIdOf = (boardId: string): string | null =>
  boardId === LOBBY_WHITEBOARD_ID ? null : boardId;
