/**
 * Browser client for the board panel routes (#36; shapes in
 * `@regulus/protocol` boards-api.ts): one card's detail, the repo's
 * assignable logins, and the write actions. The session cookie is the only
 * credential; the office calls GitHub with its own.
 */
import {
  BoardAssigneesResponse,
  type BoardAssignRequest,
  BoardCardDetail,
  BoardComment,
  type BoardMergeRequest,
  boardAssigneesPath,
  boardCardPath,
  type CardKind,
} from "@regulus/protocol";

export type BoardFailure = { ok: false; status: number; code: string; detail?: string };
export type BoardResult<T> = { ok: true; data: T } | BoardFailure;

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}
const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };
const MERGED: Parser<{ merged: boolean }> = {
  safeParse: (v) =>
    v && typeof v === "object" && typeof (v as { merged?: unknown }).merged === "boolean"
      ? { success: true, data: { merged: (v as { merged: boolean }).merged } }
      : { success: false },
};

export interface CardRef {
  operationId: string;
  kind: CardKind;
  repoId: string;
  number: number;
}

export function createBoardsApi(options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
  const base = options.baseUrl ?? "";

  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<BoardResult<T>> {
    const doFetch = options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" };
    }
    let json: unknown = null;
    if (res.status !== 204) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const b = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      return {
        ok: false,
        status: res.status,
        code: typeof b.error === "string" ? b.error : `http_${res.status}`,
        detail: typeof b.detail === "string" ? b.detail : undefined,
      };
    }
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, status: res.status, code: "unexpected_response" };
  }

  const path = (c: CardRef, action?: "comment" | "assign" | "merge" | "close") =>
    boardCardPath(c.operationId, c.kind, c.repoId, c.number, action);

  return {
    detail: (c: CardRef) => call("GET", path(c), BoardCardDetail),
    assignees: (operationId: string, repoId: string) =>
      call("GET", boardAssigneesPath(operationId, repoId), BoardAssigneesResponse),
    comment: (c: CardRef, body: string) => call("POST", path(c, "comment"), BoardComment, { body }),
    assign: (c: CardRef, change: BoardAssignRequest) =>
      call("POST", path(c, "assign"), NO_CONTENT, change),
    merge: (c: CardRef, method: BoardMergeRequest["method"]) =>
      call("POST", path(c, "merge"), MERGED, { method }),
    close: (c: CardRef) => call("POST", path(c, "close"), NO_CONTENT, {}),
  };
}

export type BoardsApi = ReturnType<typeof createBoardsApi>;

/** Human wording for a failed board call. */
export function describeBoardFailure(f: BoardFailure): string {
  switch (f.code) {
    case "manage_required":
      return "Only people who manage this operation can do that.";
    case "office_credential_missing":
      return "The office has no GitHub connection for this repo. An owner or admin can connect one in Settings.";
    case "card_not_found":
      return "This card is no longer on the board.";
    case "github_rejected":
      return `GitHub refused: ${f.detail ?? "no detail"}`;
    case "github_unavailable":
      return "GitHub could not be reached. Try again in a moment.";
    case "network_error":
      return "The office could not be reached.";
    default:
      return `Something went wrong (${f.code}).`;
  }
}
