/**
 * Browser client for linked tasks (#257): the ones with a part in a room as
 * this person may see them, create, and stop. The server checks every call.
 */
import {
  type CreateLinkedTaskRequest,
  LINKED_TASKS_API_PATH,
  LinkedTaskCreated,
  LinkedTaskListResponse,
  LinkedTaskOk,
  LinkedTaskStopped,
  linkedNoteReleasePath,
  linkedTaskAutoNotesPath,
  linkedTaskStopPath,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export function createLinkedTasksApi(options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
  const base = options.baseUrl ?? "";

  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<ApiResult<T>> {
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
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const b = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const out: ApiFailure = {
        ok: false,
        status: res.status,
        code: typeof b.error === "string" ? b.error : `http_${res.status}`,
      };
      if (typeof b.message === "string") out.reason = b.message;
      return out;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  return {
    list: (operationId: string) =>
      call(
        "GET",
        `${LINKED_TASKS_API_PATH}?operationId=${encodeURIComponent(operationId)}`,
        LinkedTaskListResponse,
      ),
    create: (req: CreateLinkedTaskRequest) =>
      call("POST", LINKED_TASKS_API_PATH, LinkedTaskCreated, req),
    stop: (id: string) => call("POST", linkedTaskStopPath(id), LinkedTaskStopped),
    releaseNote: (id: string, noteId: string) =>
      call("POST", linkedNoteReleasePath(id, noteId), LinkedTaskOk),
    setAutoNotes: (id: string, on: boolean) =>
      call("PUT", linkedTaskAutoNotesPath(id), LinkedTaskOk, { on }),
  };
}

export type LinkedTasksApi = ReturnType<typeof createLinkedTasksApi>;

export function describeLinkedTaskError(f: ApiFailure): string {
  if (f.code === "network_error") return "The office cannot be reached.";
  if (f.code === "invalid_body") return "This task is not accepted.";
  return f.reason ? `The office refused: ${f.reason}.` : `The office refused (${f.code}).`;
}
