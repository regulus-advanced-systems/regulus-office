/**
 * Wall picture rows and files (#46, SPEC §5 `decor`). Images live on disk
 * as `<dataDir>/pictures/<uuid>.<ext>`, named by the office and never by the
 * client; the row's `blobPath` is that path relative to the data dir
 * (`pictures/<file>`), and every read resolves it back inside the pictures
 * directory or refuses it (a row edited to `../..` serves nothing).
 */
import { readdir, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { type DecorState, type WallPictureKind, wallPictureImagePath } from "@regulus/protocol";
import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { decor } from "../db/schema/index.ts";
import { PICTURE_EXT } from "./image.ts";

/** Sub-directory of the data dir that holds picture files. */
export const PICTURE_DIR = "pictures";

export type DecorRow = typeof decor.$inferSelect;

export interface NewPicture {
  operationId: string;
  wallId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  blobPath: string;
  placedBy: string;
}

export interface PictureRect {
  wallId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export class PictureStore {
  readonly db: Db;
  readonly dir: string;

  constructor(db: Db, dataDir: string) {
    this.db = db;
    this.dir = resolve(dataDir, PICTURE_DIR);
  }

  /** A fresh file name for an image of `kind`, as stored in `blobPath`. */
  newBlobPath(kind: WallPictureKind): string {
    return `${PICTURE_DIR}/${crypto.randomUUID()}.${PICTURE_EXT[kind]}`;
  }

  /** Absolute path of a `blobPath`, or null when it would leave the pictures directory. */
  pathOf(blobPath: string | null | undefined): string | null {
    if (!blobPath?.startsWith(`${PICTURE_DIR}/`)) return null;
    const path = resolve(this.dir, blobPath.slice(PICTURE_DIR.length + 1));
    return path.startsWith(this.dir + sep) ? path : null;
  }

  /** Content type of a stored picture by its (office-chosen) extension. */
  mimeOf(path: string): string {
    return MIME_BY_EXT[path.slice(path.lastIndexOf(".") + 1)] ?? "application/octet-stream";
  }

  list(operationId: string): DecorRow[] {
    return this.db
      .select()
      .from(decor)
      .where(and(eq(decor.operationId, operationId), eq(decor.kind, "picture")))
      .orderBy(asc(decor.createdAt))
      .all();
  }

  /** Every operation with pictures, for publishing them at boot. */
  operationIds(): string[] {
    const rows = this.db
      .selectDistinct({ operationId: decor.operationId })
      .from(decor)
      .where(eq(decor.kind, "picture"))
      .all();
    return rows.flatMap((r) => (r.operationId ? [r.operationId] : []));
  }

  get(operationId: string, id: string): DecorRow | undefined {
    return this.db
      .select()
      .from(decor)
      .where(and(eq(decor.id, id), eq(decor.operationId, operationId), eq(decor.kind, "picture")))
      .get();
  }

  countOn(operationId: string): number {
    const [row] = this.db
      .select({ n: count() })
      .from(decor)
      .where(and(eq(decor.operationId, operationId), eq(decor.kind, "picture")))
      .all();
    return row?.n ?? 0;
  }

  add(p: NewPicture): DecorRow {
    return this.db
      .insert(decor)
      .values({ ...p, kind: "picture" })
      .returning()
      .get();
  }

  move(id: string, rect: PictureRect): void {
    this.db.update(decor).set(rect).where(eq(decor.id, id)).run();
  }

  /** Delete the row and its file. */
  async remove(row: DecorRow): Promise<void> {
    this.db.delete(decor).where(eq(decor.id, row.id)).run();
    const path = this.pathOf(row.blobPath);
    if (path) await unlink(path).catch(() => {});
  }

  /** Delete a file that never made it into a row (an expired upload). */
  async discard(blobPath: string): Promise<void> {
    const path = this.pathOf(blobPath);
    if (path) await unlink(path).catch(() => {});
  }

  /**
   * Remove files no row refers to (deleted operations, uploads never hung
   * before a restart). Run at boot, before any upload is pending.
   */
  async prune(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return 0;
    }
    const keep = new Set(
      this.db
        .select({ blobPath: decor.blobPath })
        .from(decor)
        .all()
        .flatMap((r) => (r.blobPath ? [r.blobPath] : [])),
    );
    let removed = 0;
    for (const name of names) {
      if (keep.has(`${PICTURE_DIR}/${name}`)) continue;
      await unlink(join(this.dir, name)).catch(() => {});
      removed += 1;
    }
    return removed;
  }
}

/** The OperationRoom shape of a picture row. */
export function toDecorState(row: DecorRow): DecorState {
  return {
    id: row.id,
    kind: row.kind,
    wallId: row.wallId,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    imageUrl: row.operationId ? wallPictureImagePath(row.operationId, row.id) : "",
    placedBy: row.placedBy ?? "",
  };
}
