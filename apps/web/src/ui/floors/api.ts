/**
 * Browser client for the floors REST API (SPEC §5, §9.1): list the floors
 * the signed-in user can see, create one (owner/admin), retry a failed
 * clone, and list, grant, change and revoke floor members. Repo tokens go out in request bodies only; responses never carry
 * them (the server returns `hasCredential`), and nothing is stored here.
 */
import {
  type CreateFloorRequest,
  FLOORS_API_PATH,
  type FloorAccess,
  FloorInfo,
  FloorListResponse,
  FloorMembersResponse,
  FloorRepoInfo,
  OFFICE_USERS_API_PATH,
  OfficeUsersResponse,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

/** The slice of a zod schema used here (the web app does not depend on zod directly). */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** For 204 responses. */
const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };

export interface FloorsApiOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

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
  if (typeof b.repo === "number") out.reason = `repo ${b.repo + 1}`;
  if (Array.isArray(b.fields))
    out.reason = b.fields.filter((f) => typeof f === "string").join(", ");
  return out;
}

export function createFloorsApi(options: FloorsApiOptions = {}) {
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
    const json = await readJson(res);
    if (!res.ok) return failure(res.status, json);
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, code: "unexpected_response" };
    return { ok: true, data: parsed.data };
  }

  const memberPath = (floorId: string, userId?: string) =>
    `${FLOORS_API_PATH}/${encodeURIComponent(floorId)}/members${
      userId === undefined ? "" : `/${encodeURIComponent(userId)}`
    }`;

  return {
    list: () => call<FloorListResponse>("GET", FLOORS_API_PATH, FloorListResponse),
    create: (request: CreateFloorRequest) =>
      call<FloorInfo>("POST", FLOORS_API_PATH, FloorInfo, request),
    retryClone: (floorId: string, repoId: string, token?: string) =>
      call<FloorRepoInfo>(
        "POST",
        `${FLOORS_API_PATH}/${encodeURIComponent(floorId)}/repos/${encodeURIComponent(repoId)}/clone`,
        FloorRepoInfo,
        token ? { token } : {},
      ),
    members: (floorId: string) =>
      call<FloorMembersResponse>("GET", memberPath(floorId), FloorMembersResponse),
    setMember: (floorId: string, userId: string, access: FloorAccess) =>
      call<void>("PUT", memberPath(floorId, userId), NO_CONTENT, { access }),
    removeMember: (floorId: string, userId: string) =>
      call<void>("DELETE", memberPath(floorId, userId), NO_CONTENT),
    /** Office people to grant (floor managers only; emails for owners and admins). */
    people: () => call<OfficeUsersResponse>("GET", OFFICE_USERS_API_PATH, OfficeUsersResponse),
  };
}

export type FloorsApi = ReturnType<typeof createFloorsApi>;

/** Human wording for a failed floors call. */
export function describeFloorError(err: ApiFailure): string {
  switch (err.code) {
    case "network_error":
      return "Could not reach the office server. Check your connection and try again.";
    case "owner_or_admin_required":
      return "Only owners and admins can add floors.";
    case "invalid_repo":
      return `${err.reason ?? "A repo"} is not a GitHub repo. Use owner/name or https://github.com/owner/name.`;
    case "unsupported_host":
      return `${err.reason ?? "A repo"} is not on github.com.`;
    case "credentials_in_url":
      return `${err.reason ?? "A repo"} has a token in its URL. Put the token in the token field instead.`;
    case "duplicate_repo":
      return "The same repo is listed twice.";
    case "unknown_palette":
      return "That palette does not exist.";
    case "master_key_required":
      return "Tokens cannot be stored: the server has no OFFICE_MASTER_KEY. Use public repos or ask the operator to set one.";
    case "invalid_body":
      return `Some fields are missing or invalid${err.reason ? ` (${err.reason})` : ""}.`;
    case "floor_manage_required":
      return "You need manage access to this floor to change who can use it.";
    case "floor_not_found":
      return "That floor no longer exists or you no longer have access to it.";
    case "user_not_found":
      return "That person is no longer in the office.";
    case "member_not_found":
      return "That person no longer has access to this floor.";
    case "unauthorized":
      return "Your session has ended. Sign in again.";
    case "origin_mismatch":
      return "The request came from an unexpected origin; reload the page from the office URL.";
    default:
      return `Something went wrong (${err.code}).`;
  }
}
