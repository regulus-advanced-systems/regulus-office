/**
 * Browser client for the meeting room (#50): an operation's meetings, the
 * live ones for door signs, a meeting's transcript, start and control. The
 * server checks every call again (operation access to watch, `spawn` to
 * start, the starter to control).
 */
import {
  ActiveMeetingsResponse,
  MEETINGS_ACTIVE_PATH,
  MEETINGS_API_PATH,
  type MeetingAction,
  MeetingDetail,
  MeetingListResponse,
  MeetingSummary,
  meetingActionPath,
  meetingPath,
  type StartMeetingRequest,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export function createMeetingsApi(options: { fetch?: typeof fetch; baseUrl?: string } = {}) {
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
      if (Array.isArray(b.fields))
        out.reason = b.fields.filter((f) => typeof f === "string").join(", ");
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
        `${MEETINGS_API_PATH}?operationId=${encodeURIComponent(operationId)}`,
        MeetingListResponse,
      ),
    active: () => call("GET", MEETINGS_ACTIVE_PATH, ActiveMeetingsResponse),
    detail: (id: string) => call("GET", meetingPath(id), MeetingDetail),
    start: (req: StartMeetingRequest) => call("POST", MEETINGS_API_PATH, MeetingSummary, req),
    act: (id: string, action: MeetingAction) =>
      call("POST", meetingActionPath(id, action), MeetingSummary),
  };
}

export type MeetingsApi = ReturnType<typeof createMeetingsApi>;

const MESSAGES: Record<string, string> = {
  network_error: "The office cannot be reached.",
  invalid_body: "Some fields are not valid",
  forbidden: "You may not do that",
  no_free_desks: "Not enough free desks",
  in_session: "A meeting is already in session in this room",
  repo_not_ready: "The repo is not cloned yet",
  no_pull_branch: "That pull request cannot be reviewed here",
  member_left: "A member went back to barracks",
};

export function describeMeetingError(f: ApiFailure): string {
  const base = MESSAGES[f.code] ?? `The office refused the request (${f.code})`;
  return f.reason && f.reason !== base ? `${base}: ${f.reason}` : `${base}.`;
}
