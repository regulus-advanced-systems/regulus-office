/**
 * Browser client for "Connect providers" (SPEC §8): CLI login status and
 * flows, and key profiles. Keys go out in request bodies only; responses
 * never carry them, and nothing here stores them.
 */
import {
  type CliLoginProvider,
  CREDENTIAL_PROFILE_WRITE_PATH,
  type CreateKeyProfileRequest,
  KeyProfileListResponse,
  KeyProfileWriteResponse,
  LoginFlowInfo,
  PROVIDER_LOGINS_API_PATH,
  ProviderLoginStatusResponse,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface ProvidersApiOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

const NO_CONTENT: Parser<null> = { safeParse: () => ({ success: true, data: null }) };

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function failure(status: number, body: unknown): ApiFailure {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof b.error === "string" ? b.error.toLowerCase() : `http_${status}`;
  const out: ApiFailure = { ok: false, status, code };
  if (Array.isArray(b.fields))
    out.reason = b.fields.filter((f) => typeof f === "string").join(", ");
  if (typeof b.retryAfterSeconds === "number") out.retryAfterSeconds = b.retryAfterSeconds;
  return out;
}

export function createProvidersApi(options: ProvidersApiOptions = {}) {
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
    if (res.status === 204) return { ok: true, data: null as T };
    const json = await readJson(res);
    if (!res.ok) return failure(res.status, json);
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  const flowPath = (loginId: string) =>
    `${PROVIDER_LOGINS_API_PATH}/flows/${encodeURIComponent(loginId)}`;
  const profilePath = (id: string) => `${CREDENTIAL_PROFILE_WRITE_PATH}/${encodeURIComponent(id)}`;

  return {
    loginStatus: () => call("GET", PROVIDER_LOGINS_API_PATH, ProviderLoginStatusResponse),
    startLogin: (provider: CliLoginProvider) =>
      call("POST", `${PROVIDER_LOGINS_API_PATH}/${provider}`, LoginFlowInfo),
    flow: (loginId: string) => call("GET", flowPath(loginId), LoginFlowInfo),
    cancelLogin: (loginId: string) => call("POST", `${flowPath(loginId)}/cancel`, NO_CONTENT),
    profiles: () => call("GET", `${CREDENTIAL_PROFILE_WRITE_PATH}/manage`, KeyProfileListResponse),
    createProfile: (request: CreateKeyProfileRequest) =>
      call("POST", CREDENTIAL_PROFILE_WRITE_PATH, KeyProfileWriteResponse, request),
    verifyProfile: (id: string, apiKey: string) =>
      call("POST", `${profilePath(id)}/verify`, KeyProfileWriteResponse, { apiKey }),
    deleteProfile: (id: string) => call("DELETE", profilePath(id), NO_CONTENT),
  };
}

export type ProvidersApi = ReturnType<typeof createProvidersApi>;

/** Human wording for a failed providers call. */
export function describeProvidersError(err: ApiFailure): string {
  switch (err.code) {
    case "network_error":
      return "Could not reach the office server. Check your connection and try again.";
    case "key_rejected":
      return "The provider rejected this key. Check it and paste it again.";
    case "master_key_required":
      return "Keys cannot be stored: the server has no OFFICE_MASTER_KEY. Ask the operator to set one.";
    case "owner_or_admin_required":
      return "Only owners and admins can add office-wide keys.";
    case "office_key_not_metered":
      return "Only pay-per-token providers can be office-wide keys. Plans stay personal.";
    case "viewers_cannot_connect":
      return "Viewers cannot connect providers.";
    case "base_url_required":
      return "This endpoint needs a base URL.";
    case "base_url_not_allowed":
      return "This preset has a fixed endpoint.";
    case "login_unavailable":
      return "The sign-in could not start in your runner. Is the CLI installed there?";
    case "rate_limited":
      return `Too many attempts. Try again in ${err.retryAfterSeconds ?? 60} s.`;
    case "invalid_body":
      return `Some fields are missing or invalid${err.reason ? ` (${err.reason})` : ""}.`;
    case "unauthorized":
      return "Your session has ended. Sign in again.";
    case "not_found":
      return "It no longer exists.";
    default:
      return `Something went wrong (${err.code}).`;
  }
}
