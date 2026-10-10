/**
 * Browser client for the room's bookshelf (#264; shapes in
 * `@regulus/protocol` bookshelf-api.ts). The session cookie is the only
 * credential; answers are schema-checked. A 404 means the room is not the
 * caller's to read (or is gone), whatever was asked.
 */
import {
  BookshelfDocument,
  BookshelfListing,
  BookshelfSearchResponse,
  bookshelfApiPath,
  bookshelfDocApiPath,
  bookshelfSearchApiPath,
} from "@regulus/protocol";

export type ShelfFailure = "closed" | "too_large" | "not_text" | "unavailable" | "busy" | "failed";
export type ShelfResult<T> = { ok: true; data: T } | { ok: false; error: ShelfFailure };

export interface BookshelfApi {
  listing(operationId: string, signal?: AbortSignal): Promise<ShelfResult<BookshelfListing>>;
  document(
    operationId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<ShelfResult<BookshelfDocument>>;
  search(
    operationId: string,
    q: string,
    signal?: AbortSignal,
  ): Promise<ShelfResult<BookshelfSearchResponse>>;
}

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function failureOf(status: number): ShelfFailure {
  if (status === 401 || status === 404) return "closed";
  if (status === 413) return "too_large";
  if (status === 429) return "busy";
  if (status === 415) return "not_text";
  return status === 503 ? "unavailable" : "failed";
}

export function createBookshelfApi(options: { fetch?: typeof fetch } = {}): BookshelfApi {
  async function get<T>(path: string, schema: Parser<T>, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await (options.fetch ?? fetch)(path, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal,
      });
    } catch {
      return { ok: false, error: "failed" } as const;
    }
    if (!res.ok) return { ok: false, error: failureOf(res.status) } as const;
    try {
      const parsed = schema.safeParse(await res.json());
      return parsed.success
        ? ({ ok: true, data: parsed.data } as const)
        : ({ ok: false, error: "failed" } as const);
    } catch {
      return { ok: false, error: "failed" } as const;
    }
  }
  return {
    listing: (operationId, signal) => get(bookshelfApiPath(operationId), BookshelfListing, signal),
    document: (operationId, path, signal) =>
      get(bookshelfDocApiPath(operationId, path), BookshelfDocument, signal),
    search: (operationId, q, signal) =>
      get(bookshelfSearchApiPath(operationId, q), BookshelfSearchResponse, signal),
  };
}

export const defaultBookshelfApi = createBookshelfApi();
