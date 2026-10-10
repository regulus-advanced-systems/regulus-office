/**
 * Bookshelf REST (#264; shapes and paths in `@regulus/protocol`
 * bookshelf-api.ts), session-cookie auth, read only:
 *
 *   GET /api/operations/:operationId/docs               the shelf
 *   GET /api/operations/:operationId/docs/file?path=    one document
 *   GET /api/operations/:operationId/docs/image?path=   a picture a document shows
 *   GET /api/operations/:operationId/docs/search?q=     lines containing the text
 *
 * The access gate is asked on every request, before the path or the query
 * is looked at (service.ts), so a person who may not see the room gets 404
 * `not_found` whatever they send, exactly as for a room that does not exist.
 *
 * Documents go out as JSON (the Markdown source as a string; the browser
 * renders it through the safe renderer, never as HTML). Pictures go out
 * with the content type their own bytes say, `nosniff`, a sandboxing CSP
 * and same-origin resource policy, so a file in a repo can never run as a
 * page on the office's origin. Nothing here is cacheable by a shared cache.
 */
import type { BookshelfError } from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, unauthorized } from "../auth/errors.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { OperationActor } from "../operations/access.ts";
import { DOC_IMAGE_MIME } from "./image.ts";
import type { Answer, Bookshelf } from "./service.ts";

export const BOOKSHELF_ROUTE = "/api/operations/:operationId/docs";

const STATUS: Readonly<Record<BookshelfError, number>> = {
  not_found: 404,
  bad_path: 400,
  bad_query: 400,
  too_large: 413,
  not_text: 415,
  not_image: 415,
  unavailable: 503,
};

const NO_STORE = { "cache-control": "private, no-store" } as const;

export interface BookshelfRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest">;
  bookshelf: Bookshelf;
}

export function mountBookshelfRoutes(router: Router, deps: BookshelfRoutesDeps): void {
  const { auth, bookshelf } = deps;
  const handle =
    (fn: (ctx: RouteContext, actor: OperationActor, operationId: string) => Promise<Response>) =>
    async (ctx: RouteContext): Promise<Response> => {
      try {
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return await fn(ctx, { id: user.id, role: user.role }, ctx.params.operationId ?? "");
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };
  const answer = <T>(result: Answer<T>): Response => {
    // The same response as every other route gives for a room that is closed or missing.
    if (!result.ok && result.error === "not_found") throw new AuthHttpError(404, "not_found");
    if (!result.ok) return json({ error: result.error }, { status: STATUS[result.error] });
    return json(result.value, { headers: NO_STORE });
  };

  router.get(
    BOOKSHELF_ROUTE,
    handle(async (_ctx, actor, operationId) => answer(await bookshelf.listing(actor, operationId))),
  );

  router.get(
    `${BOOKSHELF_ROUTE}/file`,
    handle(async (ctx, actor, operationId) =>
      answer(await bookshelf.document(actor, operationId, ctx.url.searchParams.get("path"))),
    ),
  );

  router.get(
    `${BOOKSHELF_ROUTE}/search`,
    handle(async (ctx, actor, operationId) =>
      answer(await bookshelf.search(actor, operationId, ctx.url.searchParams.get("q"))),
    ),
  );

  router.get(
    `${BOOKSHELF_ROUTE}/image`,
    handle(async (ctx, actor, operationId) => {
      const result = await bookshelf.image(actor, operationId, ctx.url.searchParams.get("path"));
      if (!result.ok) return answer(result);
      const { bytes, kind, oid } = result.value;
      const etag = `"${oid}"`;
      const headers = {
        // Revalidated every time, so the gate is asked again before a cached copy is shown.
        "cache-control": "private, no-cache",
        etag,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin",
      };
      if (ctx.request.headers.get("if-none-match") === etag)
        return new Response(null, { status: 304, headers });
      return new Response(bytes as Uint8Array<ArrayBuffer>, {
        headers: { ...headers, "content-type": DOC_IMAGE_MIME[kind] },
      });
    }),
  );
}
