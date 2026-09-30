/**
 * Browser client for search (#41; shapes in `@regulus/protocol` search-api.ts).
 * The session cookie is the only credential; answers are schema-checked.
 */
import {
  SEARCH_API_PATH,
  SEARCH_CONTEXT_API_PATH,
  SearchContextResponse,
  SearchResponse,
} from "@regulus/protocol";

export type SearchFailure = "rate_limited" | "unauthorized" | "not_found" | "failed";
export type SearchResult<T> = { ok: true; data: T } | { ok: false; error: SearchFailure };

export interface SearchApi {
  search(q: string, signal?: AbortSignal): Promise<SearchResult<SearchResponse>>;
  context(
    docId: number,
    q: string,
    signal?: AbortSignal,
  ): Promise<SearchResult<SearchContextResponse>>;
}

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function failureOf(status: number): SearchFailure {
  if (status === 429) return "rate_limited";
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  return "failed";
}

export function createSearchApi(options: { fetch?: typeof fetch } = {}): SearchApi {
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
    search: (q, signal) =>
      get(`${SEARCH_API_PATH}?q=${encodeURIComponent(q)}`, SearchResponse, signal),
    context: (docId, q, signal) =>
      get(
        `${SEARCH_CONTEXT_API_PATH}?doc=${docId}&q=${encodeURIComponent(q)}`,
        SearchContextResponse,
        signal,
      ),
  };
}

export const defaultSearchApi = createSearchApi();
