/**
 * Browser client for the watchdog (#253): the report everyone may read
 * (each within what they may see), and, for owners and admins, what it
 * watches. An SSH key or the Sentry token goes out in one request body; no
 * response carries one.
 */
import {
  type DecideWatchdogFix,
  type SaveWatchdogHost,
  type SetWatchdogSentryProjects,
  type UpdateWatchdogSettings,
  WATCHDOG_API_PATH,
  WATCHDOG_HOSTS_API_PATH,
  WATCHDOG_NEWS_API_PATH,
  WATCHDOG_ROUNDS_API_PATH,
  WATCHDOG_SENTRY_PROJECTS_API_PATH,
  WATCHDOG_SETTINGS_API_PATH,
  WatchdogFindingView,
  WatchdogHostView,
  WatchdogNews,
  WatchdogReport,
  WatchdogSettingsView,
  watchdogFixPath,
  watchdogHostKeyPath,
  watchdogHostPath,
  watchdogNoisePath,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}
const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };

export function createWatchdogApi(options: { fetch?: typeof fetch } = {}) {
  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await (options.fetch ?? fetch)(path, {
        method,
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: "network_error" };
    }
    const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const b = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const failure: ApiFailure = {
        ok: false,
        status: res.status,
        code: typeof b.error === "string" ? b.error.toLowerCase() : `http_${res.status}`,
      };
      if (typeof b.message === "string") failure.reason = b.message;
      return failure;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  return {
    report: () => call("GET", WATCHDOG_API_PATH, WatchdogReport),
    /** What this person was not told of yet; asking counts as being told. */
    news: () => call("POST", WATCHDOG_NEWS_API_PATH, WatchdogNews),
    runNow: () => call("POST", WATCHDOG_ROUNDS_API_PATH, WatchdogReport),
    decideFix: (findingId: string, decision: DecideWatchdogFix["decision"]) =>
      call("POST", watchdogFixPath(findingId), WatchdogFindingView, { decision }),
    markNoise: (findingId: string, noise: boolean) =>
      call("POST", watchdogNoisePath(findingId), WatchdogFindingView, { noise }),
    acceptHostKey: (id: string) => call("POST", watchdogHostKeyPath(id), WatchdogHostView),
    settings: () => call("GET", WATCHDOG_SETTINGS_API_PATH, WatchdogSettingsView),
    updateSettings: (patch: UpdateWatchdogSettings) =>
      call("PATCH", WATCHDOG_SETTINGS_API_PATH, WatchdogSettingsView, patch),
    setSentryProjects: (input: SetWatchdogSentryProjects) =>
      call("PUT", WATCHDOG_SENTRY_PROJECTS_API_PATH, WatchdogSettingsView, input),
    createHost: (input: SaveWatchdogHost) =>
      call("POST", WATCHDOG_HOSTS_API_PATH, WatchdogHostView, input),
    updateHost: (id: string, input: SaveWatchdogHost) =>
      call("PUT", watchdogHostPath(id), WatchdogHostView, input),
    deleteHost: (id: string) => call("DELETE", watchdogHostPath(id), NO_CONTENT),
  };
}

export type WatchdogApi = ReturnType<typeof createWatchdogApi>;

const ERRORS: Record<string, string> = {
  owner_or_admin_required: "Only office owners and admins can set the watchdog up.",
  master_key_required: "The server has no OFFICE_MASTER_KEY, so it cannot store keys or tokens.",
  private_key_required: "A new host needs its SSH private key.",
  no_such_room: "That room is not one you can see.",
  room_not_yours:
    "That target is in a room you cannot see, so you cannot move it or watch it again. You can stop watching it.",
  not_a_watchdog: "Pick a shared agent whose job is Watchdog.",
  too_many_hosts: "That is the most hosts the watchdog can watch.",
  not_configured: "Pick a watchdog and give it something to watch first.",
  not_found: "That is gone, or it is not yours to see.",
  invalid_body: "Some fields are missing or invalid.",
  network_error: "The office is not reachable.",
};

/** A server message where it gave one (it is written for people), else the code in words. */
export function describeWatchdogError(failure: ApiFailure): string {
  if (ERRORS[failure.code]) return ERRORS[failure.code] as string;
  if (failure.code === "nothing_offered" && !failure.reason) {
    return "That host shows no new key to accept.";
  }
  return failure.reason ? `${failure.reason}.` : `Something went wrong (${failure.code}).`;
}
