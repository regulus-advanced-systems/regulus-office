/**
 * Whiteboard REST (#45). Session-cookie auth and board access (./access.ts);
 * the upload also needs a same-origin request (CSRF), like every write route.
 *
 *   GET /api/whiteboards/:boardId            version and the caller's access (view)
 *   GET /api/whiteboards/:boardId/snapshot   the wall snapshot PNG (view; ETag by version)
 *   PUT /api/whiteboards/:boardId/snapshot   a new snapshot from an editing client (edit)
 *
 * The snapshot is what every unfocused board on a wall shows. Browsers render
 * it (Excalidraw `exportToBlob`, throttled to one per 2 s per editor) because
 * the server has no Excalidraw renderer; it is checked to be a PNG of sane
 * size and dimensions, written to `<dataDir>/whiteboards/`, and its version
 * bump goes out through the room state (`OperationState.whiteboardVersion`,
 * or `BuildingState.lobbyWhiteboardVersion` for the lobby board).
 * Refusals: 401 no session, 404 no such board or no access, 403 read-only or
 * cross-origin, 400 not a PNG, 413 too big.
 */
import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  WHITEBOARD_SNAPSHOT_MAX_BYTES,
  type WhiteboardInfo,
  type WhiteboardSnapshotResponse,
} from "@regulus/protocol";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { BoardAccessCheck, BoardUser } from "./access.ts";
import type { WhiteboardStore } from "./store.ts";

export const WHITEBOARD_API_ROUTE = "/api/whiteboards/:boardId";
export const WHITEBOARD_SNAPSHOT_ROUTE = "/api/whiteboards/:boardId/snapshot";

/** Largest snapshot side accepted, pixels (the client sends at most 1600). */
export const SNAPSHOT_MAX_SIDE = 4096;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface WhiteboardRouteDeps {
  sessions: { getSessionFromRequest(request: Request): Promise<BoardUser | null> };
  publicUrl: string;
  allowedOrigins?: readonly string[];
  store: WhiteboardStore;
  access: BoardAccessCheck;
  /** `<dataDir>/whiteboards`. */
  snapshotDir: string;
  onSnapshot: (boardId: string, version: number) => void;
}

/** Width and height of a PNG, or null when `bytes` is not one. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  // The first chunk must be IHDR: length(4) "IHDR"(4) width(4) height(4).
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const notFound = () => new AuthHttpError(404, "not_found");

export function mountWhiteboardRoutes(router: Router, deps: WhiteboardRouteDeps): void {
  const handle =
    (fn: (ctx: RouteContext, user: BoardUser, boardId: string) => Promise<Response> | Response) =>
    async (ctx: RouteContext): Promise<Response> => {
      try {
        const user = await deps.sessions.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return await fn(ctx, user, ctx.params.boardId ?? "");
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  router.get(
    WHITEBOARD_API_ROUTE,
    handle((_ctx, user, boardId) => {
      const access = deps.access(user, boardId);
      if (!access) throw notFound();
      const info: WhiteboardInfo = {
        boardId,
        version: deps.store.load(boardId)?.version ?? 0,
        access,
      };
      return json(info, { headers: { "cache-control": "no-store" } });
    }),
  );

  router.get(
    WHITEBOARD_SNAPSHOT_ROUTE,
    handle(async (ctx, user, boardId) => {
      if (!deps.access(user, boardId)) throw notFound();
      const record = deps.store.load(boardId);
      if (!record?.snapshotPng) throw notFound();
      const file = Bun.file(join(deps.snapshotDir, record.snapshotPng));
      if (!(await file.exists())) throw notFound();
      const etag = `"v${record.version}"`;
      const headers = { etag, "cache-control": "private, no-cache", "content-type": "image/png" };
      if (ctx.request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(file, { headers });
    }),
  );

  router.add(
    "PUT",
    WHITEBOARD_SNAPSHOT_ROUTE,
    handle(async (ctx, user, boardId) => {
      const origin = checkOrigin(ctx.request, deps.publicUrl, {
        allowedOrigins: deps.allowedOrigins,
      });
      if (!origin.ok) throw forbidden("origin_mismatch");
      const access = deps.access(user, boardId);
      if (!access) throw notFound();
      if (access !== "edit") throw forbidden("read_only");
      const declared = Number(ctx.request.headers.get("content-length") ?? 0);
      if (declared > WHITEBOARD_SNAPSHOT_MAX_BYTES) throw new AuthHttpError(413, "too_large");
      const bytes = new Uint8Array(await ctx.request.arrayBuffer());
      if (bytes.byteLength > WHITEBOARD_SNAPSHOT_MAX_BYTES) {
        throw new AuthHttpError(413, "too_large");
      }
      const size = pngSize(bytes);
      if (!size || size.width < 1 || size.height < 1) throw new AuthHttpError(400, "not_png");
      if (size.width > SNAPSHOT_MAX_SIDE || size.height > SNAPSHOT_MAX_SIDE) {
        throw new AuthHttpError(400, "too_many_pixels");
      }
      const name = `${boardId}.png`;
      const temp = join(deps.snapshotDir, `${name}.${crypto.randomUUID()}.tmp`);
      await Bun.write(temp, bytes, { createPath: true });
      try {
        await rename(temp, join(deps.snapshotDir, name));
      } catch (err) {
        await unlink(temp).catch(() => {});
        throw err;
      }
      const version = deps.store.saveSnapshot(boardId, name);
      deps.onSnapshot(boardId, version);
      const body: WhiteboardSnapshotResponse = { version };
      return json(body);
    }),
  );
}
