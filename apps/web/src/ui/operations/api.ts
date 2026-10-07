/**
 * Browser client for the operations REST API (SPEC §5, §9.1): list the operations
 * the signed-in user can see, create one (owner/admin), retry a failed
 * clone, list, grant, change and revoke operation members, and (owners and
 * admins, #150) archive, restore, send henchmen home and delete. Repo tokens go
 * out in request bodies only; responses never carry them (the server returns
 * `hasCredential`), and nothing is stored here.
 */
import {
  type CreateOperationRequest,
  OFFICE_USERS_API_PATH,
  OfficeUsersResponse,
  ONE_REPO_PER_ROOM_MESSAGE,
  OPERATIONS_API_PATH,
  OPERATIONS_ARCHIVED_API_PATH,
  type OperationAccess,
  OperationHasHenchmenResponse,
  type OperationHenchmanInfo,
  OperationInfo,
  OperationListResponse,
  OperationMembersResponse,
  OperationRepoInfo,
  SendOperationHomeResponse,
} from "@regulus/protocol";
import type { ApiFailure, ApiResult } from "../auth/api.ts";

/** A failed operations call; a refused delete also names the henchmen still on the operation. */
export type OperationsFailure = ApiFailure & { henchmen?: OperationHenchmanInfo[] };
export type OperationsResult<T> = { ok: true; data: T } | OperationsFailure;

/** The slice of a zod schema used here (the web app does not depend on zod directly). */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** For 204 responses. */
const NO_CONTENT: Parser<void> = { safeParse: () => ({ success: true, data: undefined }) };

export interface OperationsApiOptions {
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

function failure(status: number, body: unknown): OperationsFailure {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof b.error === "string" ? b.error.toLowerCase() : `http_${status}`;
  const out: OperationsFailure = { ok: false, status, code };
  const henchmen = OperationHasHenchmenResponse.safeParse(body);
  if (henchmen.success) out.henchmen = henchmen.data.henchmen;
  if (typeof b.repo === "number") out.reason = `repo ${b.repo + 1}`;
  if (Array.isArray(b.fields))
    out.reason = b.fields.filter((f) => typeof f === "string").join(", ");
  return out;
}

export function createOperationsApi(options: OperationsApiOptions = {}) {
  const base = options.baseUrl ?? "";

  async function call<T>(
    method: string,
    path: string,
    schema: Parser<T>,
    body?: unknown,
  ): Promise<OperationsResult<T>> {
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

  const operationPath = (operationId: string, suffix = "") =>
    `${OPERATIONS_API_PATH}/${encodeURIComponent(operationId)}${suffix}`;
  const memberPath = (operationId: string, userId?: string) =>
    `${OPERATIONS_API_PATH}/${encodeURIComponent(operationId)}/members${
      userId === undefined ? "" : `/${encodeURIComponent(userId)}`
    }`;

  return {
    list: () => call<OperationListResponse>("GET", OPERATIONS_API_PATH, OperationListResponse),
    create: (request: CreateOperationRequest) =>
      call<OperationInfo>("POST", OPERATIONS_API_PATH, OperationInfo, request),
    retryClone: (operationId: string, repoId: string, token?: string) =>
      call<OperationRepoInfo>(
        "POST",
        `${OPERATIONS_API_PATH}/${encodeURIComponent(operationId)}/repos/${encodeURIComponent(repoId)}/clone`,
        OperationRepoInfo,
        token ? { token } : {},
      ),
    members: (operationId: string) =>
      call<OperationMembersResponse>("GET", memberPath(operationId), OperationMembersResponse),
    setMember: (operationId: string, userId: string, access: OperationAccess) =>
      call<void>("PUT", memberPath(operationId, userId), NO_CONTENT, { access }),
    removeMember: (operationId: string, userId: string) =>
      call<void>("DELETE", memberPath(operationId, userId), NO_CONTENT),
    /** Owners and admins (#150): archived operations, newest first. */
    archived: () =>
      call<OperationListResponse>("GET", OPERATIONS_ARCHIVED_API_PATH, OperationListResponse),
    archive: (operationId: string) =>
      call<void>("POST", operationPath(operationId, "/archive"), NO_CONTENT),
    restore: (operationId: string) =>
      call<OperationInfo>("POST", operationPath(operationId, "/restore"), OperationInfo),
    /** Send every henchman on the operation home, keeping their branches. */
    sendHome: (operationId: string) =>
      call<SendOperationHomeResponse>(
        "POST",
        operationPath(operationId, "/send-home"),
        SendOperationHomeResponse,
      ),
    /** Permanent; `confirmName` must be the operation's name. 409 carries `henchmen`. */
    remove: (operationId: string, confirmName: string) =>
      call<void>("DELETE", operationPath(operationId), NO_CONTENT, { confirmName }),
    /** Office people to grant (operation managers only; emails for owners and admins). */
    people: () => call<OfficeUsersResponse>("GET", OFFICE_USERS_API_PATH, OfficeUsersResponse),
  };
}

export type OperationsApi = ReturnType<typeof createOperationsApi>;

/** Human wording for a failed operations call. */
export function describeOperationError(err: ApiFailure): string {
  switch (err.code) {
    case "network_error":
      return "Could not reach the office server. Check your connection and try again.";
    case "owner_or_admin_required":
      return "Only office owners and admins can do that.";
    case "github_link_required":
      return "Link your GitHub account first (Settings, You): a room opens with your own GitHub access to its repo.";
    case "repo_not_visible":
      return "Your GitHub account cannot see this repo, so you cannot add a room for it.";
    case "github_unavailable":
      return "GitHub could not be asked whether you can see this repo. Try again in a moment.";
    case "operation_has_henchmen":
      return "Henchmen are still working in this operation. Send them home first, then delete it.";
    case "operation_cloning":
      return "A repo of this operation is still cloning. Wait until it has finished, then try again.";
    case "operation_busy":
      return "This operation is being deleted already.";
    case "operation_not_archived":
      return "That operation is not archived.";
    case "confirm_name_mismatch":
      return "The name you typed does not match the operation's name.";
    case "operation_files_not_removed":
      return "The operation's files could not all be removed, so it was archived instead. The server log has the details; try again from Settings → Operations.";
    case "henchmen_unavailable":
      return "Henchmen cannot be sent home right now. Try again in a moment.";
    case "invalid_repo":
      return `${err.reason ?? "A repo"} is not a GitHub repo. Use owner/name or https://github.com/owner/name.`;
    case "unsupported_host":
      return `${err.reason ?? "A repo"} is not on github.com.`;
    case "credentials_in_url":
      return `${err.reason ?? "A repo"} has a token in its URL. Put the token in the token field instead.`;
    case "one_repo_per_room":
      return ONE_REPO_PER_ROOM_MESSAGE;
    case "unknown_palette":
      return "That palette does not exist.";
    case "master_key_required":
      return "Tokens cannot be stored: the server has no OFFICE_MASTER_KEY. Use public repos or ask the operator to set one.";
    case "invalid_body":
      return `Some fields are missing or invalid${err.reason ? ` (${err.reason})` : ""}.`;
    case "operation_manage_required":
      return "You need manage access to this operation to change who can use it.";
    case "operation_not_found":
      return "That operation no longer exists or you no longer have access to it.";
    case "user_not_found":
      return "That person is no longer in the office.";
    case "member_not_found":
      return "That person no longer has access to this operation.";
    case "unauthorized":
      return "Your session has ended. Sign in again.";
    case "origin_mismatch":
      return "The request came from an unexpected origin; reload the page from the office URL.";
    default:
      return `Something went wrong (${err.code}).`;
  }
}
