/**
 * Uploaded pictures waiting to be hung (#46). The upload stores the file and
 * returns an `uploadId`; `decor.place` turns it into a `decor` row. Pending
 * uploads are kept in memory, bound to the uploader and the operation, at
 * most `pendingPerUser` per human, and expire after `pendingTtlMs` (their
 * file is deleted). A restart forgets them; the boot prune deletes their files.
 */
import { WALL_PICTURE_LIMITS } from "@regulus/protocol";

export interface PendingUpload {
  id: string;
  userId: string;
  operationId: string;
  blobPath: string;
  width: number;
  height: number;
  expiresAt: number;
}

export class PendingUploads {
  readonly #items = new Map<string, PendingUpload>();
  readonly #now: () => number;
  readonly #discard: (blobPath: string) => void;

  constructor(opts: { now?: () => number; discard: (blobPath: string) => void }) {
    this.#now = opts.now ?? Date.now;
    this.#discard = opts.discard;
  }

  /** Drop expired uploads (and their files). */
  sweep(): void {
    const now = this.#now();
    for (const [id, item] of this.#items) {
      if (item.expiresAt > now) continue;
      this.#items.delete(id);
      this.#discard(item.blobPath);
    }
  }

  countFor(userId: string): number {
    this.sweep();
    let n = 0;
    for (const item of this.#items.values()) if (item.userId === userId) n += 1;
    return n;
  }

  add(item: Omit<PendingUpload, "id" | "expiresAt">): PendingUpload {
    const pending = {
      ...item,
      id: crypto.randomUUID(),
      expiresAt: this.#now() + WALL_PICTURE_LIMITS.pendingTtlMs,
    };
    this.#items.set(pending.id, pending);
    return pending;
  }

  /** The upload, if it is this user's for this operation and still fresh. */
  peek(id: string, userId: string, operationId: string): PendingUpload | null {
    this.sweep();
    const item = this.#items.get(id);
    if (!item || item.userId !== userId || item.operationId !== operationId) return null;
    return item;
  }

  /** Forget the upload (hung: its file now belongs to a row). */
  take(id: string): void {
    this.#items.delete(id);
  }

  /** Forget everything and delete the files (shutdown is not needed: the boot prune does it). */
  clear(): void {
    for (const item of this.#items.values()) this.#discard(item.blobPath);
    this.#items.clear();
  }
}
