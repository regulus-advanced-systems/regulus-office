/**
 * Wall picture REST (#46), session-cookie auth:
 *
 *   POST /api/operations/:operationId/pictures           upload (multipart `file`); spawn or
 *                                                        manage access, same-origin only
 *   GET  /api/operations/:operationId/pictures/:decorId  a hung picture's image; view access
 *
 * Access is checked before the body is read. The body is read through the
 * shared capped reader (http/body.ts, #241): the 10 MB file plus multipart
 * framing, refused as soon as it passes that, chunked or not. The image is
 * checked by its magic bytes and parsed container, its metadata dropped
 * (image.ts), and stored under the data dir by an office-chosen name. No
 * remote URL is ever fetched (SPEC §11: uploads only).
 * Refusals: 401 no session, 404 no such operation or no access, 403 view only
 * or cross-origin, 413 too large, 400 not an image or too many pixels,
 * 409 room full or too many uploads waiting.
 */
import { WALL_PICTURE_LIMITS, type WallPictureUploadError } from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { declaresTooLarge, readCappedForm } from "../http/body.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { PictureActor, WallPictures } from "./service.ts";

export const PICTURES_ROUTE = "/api/operations/:operationId/pictures";
export const PICTURE_IMAGE_ROUTE = "/api/operations/:operationId/pictures/:decorId";

/** Room for the multipart boundary and headers around the file. */
export const PICTURE_MULTIPART_SLACK = 64 * 1024;
export const PICTURE_BODY_MAX_BYTES = WALL_PICTURE_LIMITS.uploadMaxBytes + PICTURE_MULTIPART_SLACK;

const STATUS: Readonly<Record<WallPictureUploadError, number>> = {
  not_image: 400,
  too_large: 413,
  too_many_pixels: 400,
  too_many_pending: 409,
  room_full: 409,
};

const refuse = (error: WallPictureUploadError) => json({ error }, { status: STATUS[error] });

export interface PictureRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  pictures: WallPictures;
}

export function mountPictureRoutes(router: Router, deps: PictureRoutesDeps): void {
  const { auth, pictures } = deps;
  const handle =
    (fn: (ctx: RouteContext, actor: PictureActor) => Promise<Response> | Response) =>
    async (ctx: RouteContext): Promise<Response> => {
      try {
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return await fn(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  router.post(
    PICTURES_ROUTE,
    handle(async (ctx, actor) => {
      const origin = checkOrigin(ctx.request, auth.publicUrl, {
        allowedOrigins: auth.allowedOrigins,
      });
      if (!origin.ok) throw forbidden("origin_mismatch");
      const operationId = ctx.params.operationId ?? "";
      const access = pictures.access(actor, operationId);
      if (!access) throw new AuthHttpError(404, "not_found");
      if (access === "view") throw forbidden("view_only");
      if (declaresTooLarge(ctx.request, PICTURE_BODY_MAX_BYTES)) return refuse("too_large");
      let form: FormData | null;
      try {
        // Capped while reading: a chunked body has no length to check up front.
        form = await readCappedForm(ctx.request, PICTURE_BODY_MAX_BYTES);
      } catch {
        return refuse("not_image");
      }
      if (!form) return refuse("too_large");
      const file = form.get("file");
      if (!(file instanceof Blob)) return refuse("not_image");
      if (file.size > WALL_PICTURE_LIMITS.uploadMaxBytes) return refuse("too_large");
      const outcome = await pictures.upload(
        actor,
        operationId,
        new Uint8Array(await file.arrayBuffer()),
      );
      if (!outcome.ok) return refuse(outcome.error);
      return json(outcome.upload, { status: 201 });
    }),
  );

  router.get(
    PICTURE_IMAGE_ROUTE,
    handle(async (ctx, actor) => {
      const path = pictures.imagePath(
        actor,
        ctx.params.operationId ?? "",
        ctx.params.decorId ?? "",
      );
      const file = path ? Bun.file(path) : null;
      if (!path || !file || !(await file.exists())) throw new AuthHttpError(404, "not_found");
      return new Response(file, {
        headers: {
          "content-type": pictures.store.mimeOf(path),
          // A picture's image never changes (a new one is a new decor id).
          "cache-control": "private, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
        },
      });
    }),
  );
}
