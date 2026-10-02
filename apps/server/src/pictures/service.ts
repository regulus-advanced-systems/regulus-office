/**
 * Wall pictures (#46): uploads, and `decor.place|move|remove` from the
 * OperationRoom, checked against the operation's generated room layout
 * (`checkPicturePlacement`, shared with the web's placement ghost) and the
 * rules in protocol/wall-pictures.ts. Every change is written to `decor` and
 * published to the operation's room state, so everyone on it sees it at once.
 */
import {
  type DecorState,
  mayEditPicture,
  mayPlacePicture,
  type OperationAccess,
  type UserRole,
  WALL_PICTURE_LIMITS,
  type WallPictureUpload,
  type WallPictureUploadError,
} from "@regulus/protocol";
import {
  checkPicturePlacement,
  generateRoom,
  maxDeskCount,
  PICTURE_PROBLEM_TEXT,
  type RoomLayout,
} from "@regulus/room-layout";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { operations } from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import { operationAccessFor } from "../operations/access.ts";
import type { DecorCommand } from "../rooms/operation/decor.ts";
import { inspectImage } from "./image.ts";
import { PendingUploads } from "./pending.ts";
import { type DecorRow, PictureStore, toDecorState } from "./store.ts";

export interface PictureActor {
  id: string;
  role: UserRole;
}

export type DecorOutcome = { ok: true; decorId: string } | { ok: false; reason: string };

export type UploadOutcome =
  | { ok: true; upload: WallPictureUpload }
  | { ok: false; error: WallPictureUploadError };

export interface WallPicturesDeps {
  db: Db;
  dataDir: string;
  logger: Logger;
  /** Replace an operation's decor in its room state. */
  publish: (operationId: string, decor: readonly DecorState[]) => void;
  now?: () => number;
}

const refuse = (reason: string): DecorOutcome => ({ ok: false, reason });

export class WallPictures {
  readonly store: PictureStore;
  readonly pending: PendingUploads;
  readonly #db: Db;
  readonly #logger: Logger;
  readonly #publish: WallPicturesDeps["publish"];
  readonly #layouts = new Map<string, RoomLayout | null>();

  constructor(deps: WallPicturesDeps) {
    this.#db = deps.db;
    this.#logger = deps.logger;
    this.#publish = deps.publish;
    this.store = new PictureStore(deps.db, deps.dataDir);
    this.pending = new PendingUploads({
      now: deps.now,
      discard: (blobPath) => void this.store.discard(blobPath),
    });
  }

  access(actor: PictureActor, operationId: string): OperationAccess | null {
    return operationAccessFor(this.#db, actor, operationId);
  }

  /** The operation room's generated interior (cached per setting); null when gone. */
  layout(operationId: string): RoomLayout | null {
    const op = this.#db
      .select({
        width: operations.width,
        depth: operations.depth,
        doorSide: operations.doorSide,
        deskCount: operations.deskCount,
        decorStyle: operations.decorStyle,
      })
      .from(operations)
      .where(and(eq(operations.id, operationId), isNull(operations.archivedAt)))
      .get();
    if (!op) return null;
    const desks = Math.min(Math.max(1, op.deskCount), maxDeskCount(op.width, op.depth));
    const key = `${op.width}x${op.depth}:${op.doorSide}:${desks}:${op.decorStyle}`;
    if (!this.#layouts.has(key)) {
      let layout: RoomLayout | null = null;
      try {
        layout = generateRoom({ ...op, deskCount: desks });
      } catch {
        layout = null;
      }
      this.#layouts.set(key, layout);
    }
    return this.#layouts.get(key) ?? null;
  }

  /** Push an operation's pictures to its room state. */
  publish(operationId: string): void {
    this.#publish(operationId, this.store.list(operationId).map(toDecorState));
  }

  /** Publish every operation's pictures (boot). */
  publishAll(): void {
    for (const id of this.store.operationIds()) this.publish(id);
  }

  /** Check, clean and store an uploaded image; the caller checked access and the body cap. */
  async upload(
    actor: PictureActor,
    operationId: string,
    bytes: Uint8Array,
  ): Promise<UploadOutcome> {
    if (bytes.byteLength === 0) return { ok: false, error: "not_image" };
    if (bytes.byteLength > WALL_PICTURE_LIMITS.uploadMaxBytes)
      return { ok: false, error: "too_large" };
    const image = inspectImage(bytes);
    if (!image) return { ok: false, error: "not_image" };
    const { width, height } = image.info;
    if (
      width > WALL_PICTURE_LIMITS.maxSidePx ||
      height > WALL_PICTURE_LIMITS.maxSidePx ||
      width * height > WALL_PICTURE_LIMITS.maxPixels
    )
      return { ok: false, error: "too_many_pixels" };
    if (this.store.countOn(operationId) >= WALL_PICTURE_LIMITS.perOperation)
      return { ok: false, error: "room_full" };
    if (this.pending.countFor(actor.id) >= WALL_PICTURE_LIMITS.pendingPerUser)
      return { ok: false, error: "too_many_pending" };
    const blobPath = this.store.newBlobPath(image.info.kind);
    const path = this.store.pathOf(blobPath);
    if (!path) throw new Error("picture path escaped its directory");
    await Bun.write(path, image.clean, { createPath: true });
    const pending = this.pending.add({ userId: actor.id, operationId, blobPath, width, height });
    this.#logger.info(
      { operationId, userId: actor.id, bytes: image.clean.byteLength, kind: image.info.kind },
      "wall picture uploaded",
    );
    return {
      ok: true,
      upload: {
        uploadId: pending.id,
        kind: image.info.kind,
        width,
        height,
        bytes: image.clean.byteLength,
      },
    };
  }

  /** The image file of a hung picture, for someone who may see the room; null otherwise. */
  imagePath(actor: PictureActor, operationId: string, decorId: string): string | null {
    if (!this.access(actor, operationId)) return null;
    const row = this.store.get(operationId, decorId);
    return row ? this.store.pathOf(row.blobPath) : null;
  }

  /** `decor.place|move|remove` from someone on the operation. */
  async run(
    actor: PictureActor,
    operationId: string,
    command: DecorCommand,
  ): Promise<DecorOutcome> {
    const access = this.access(actor, operationId);
    if (!access) return refuse("you have no access to this operation");
    if (command.type === "decor.place") return this.#place(actor, access, operationId, command);
    const row = this.store.get(operationId, command.decorId);
    if (!row) return refuse("that picture is not in this room");
    if (!mayEditPicture(access, actor.id, row.placedBy ?? ""))
      return refuse("only whoever hung it or a room manager may change that picture");
    if (command.type === "decor.remove") {
      await this.store.remove(row);
      this.publish(operationId);
      return { ok: true, decorId: row.id };
    }
    const rect = {
      wallId: command.wallId ?? row.wallId,
      x: command.x,
      y: command.y,
      w: command.w,
      h: command.h,
    };
    const problem = this.#check(operationId, rect, row.id);
    if (problem) return refuse(problem);
    this.store.move(row.id, rect);
    this.publish(operationId);
    return { ok: true, decorId: row.id };
  }

  #place(
    actor: PictureActor,
    access: OperationAccess,
    operationId: string,
    command: Extract<DecorCommand, { type: "decor.place" }>,
  ): DecorOutcome {
    if (!mayPlacePicture(access)) return refuse("you may only look around this room");
    if (command.kind !== "picture") return refuse("only pictures can be hung for now");
    const upload = this.pending.peek(command.uploadId, actor.id, operationId);
    if (!upload) return refuse("that upload is gone; upload the picture again");
    if (this.store.countOn(operationId) >= WALL_PICTURE_LIMITS.perOperation)
      return refuse("this room has as many pictures as it takes");
    const { wallId, x, y, w, h } = command;
    const rect = { wallId, x, y, w, h };
    const problem = this.#check(operationId, rect);
    if (problem) return refuse(problem);
    const row: DecorRow = this.store.add({
      operationId,
      ...rect,
      blobPath: upload.blobPath,
      placedBy: actor.id,
    });
    this.pending.take(upload.id);
    this.publish(operationId);
    this.#logger.info({ operationId, decorId: row.id, userId: actor.id }, "wall picture hung");
    return { ok: true, decorId: row.id };
  }

  /** Why the spot is refused, or null when it is fine. */
  #check(
    operationId: string,
    rect: { wallId: string; x: number; y: number; w: number; h: number },
    ignoreId?: string,
  ): string | null {
    const layout = this.layout(operationId);
    if (!layout) return "this room has no walls to hang pictures on";
    const others = this.store.list(operationId).map((r) => ({
      id: r.id,
      wallId: r.wallId,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
    }));
    const verdict = checkPicturePlacement(layout, rect.wallId, rect, others, ignoreId);
    return verdict.ok ? null : PICTURE_PROBLEM_TEXT[verdict.problem];
  }
}
