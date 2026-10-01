/**
 * Browser client for the office's auth HTTP API (SPEC §4.2 Auth): Better
 * Auth's own endpoints under /api/auth/* plus the office routes (/api/me,
 * /api/auth-config, invites, /api/join/:token).
 *
 * Credentials rule (SPEC §8): passwords go straight into the request body
 * and are never kept, logged or written to storage; the session lives only
 * in the httpOnly cookie the server sets, which `credentials: "same-origin"`
 * lets the browser send back. Responses are reduced to the fields the UI
 * needs so session tokens in response bodies are dropped on the operation.
 */
// Enums only: the package index also pulls zod and the Colyseus schemas into the bundle.
import { isUserRole, type UserRole } from "@regulus/protocol/src/enums.ts";
import { parseSessionUser, type SessionUser } from "../../state/session.ts";

export interface AuthConfig {
  /** False until the first (owner) account exists. */
  hasUsers: boolean;
  githubEnabled: boolean;
  /** Anyone may register, not just invitees (OFFICE_OPEN_SIGNUP). */
  openSignup: boolean;
}

export interface InviteInfo {
  role: UserRole;
  expiresAt: string;
}

export interface CreatedInvite extends InviteInfo {
  id: string;
  /** Absolute `/join/<token>` URL built by the server from its public URL. */
  url: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface Registration extends Credentials {
  name: string;
}

export type ApiFailure = {
  ok: false;
  status: number;
  /** Machine-readable code: Better Auth's `code` or the office's `error`, lower-cased. */
  code: string;
  /** Extra detail such as an invite rejection reason (`expired`, `used`, `not_found`). */
  reason?: string;
  retryAfterSeconds?: number;
};

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

export interface AuthApiOptions {
  fetch?: typeof fetch;
  /** Prefix for every path; empty means the page origin (the server serves the client). */
  baseUrl?: string;
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function failure(status: number, body: unknown): ApiFailure {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const raw = typeof b.code === "string" ? b.code : typeof b.error === "string" ? b.error : "";
  const out: ApiFailure = { ok: false, status, code: raw ? raw.toLowerCase() : `http_${status}` };
  if (typeof b.reason === "string") out.reason = b.reason;
  if (typeof b.retryAfterSeconds === "number") out.retryAfterSeconds = b.retryAfterSeconds;
  return out;
}

const networkFailure = (): ApiFailure => ({ ok: false, status: 0, code: "network_error" });

function parseInvite(body: unknown): InviteInfo | null {
  if (!body || typeof body !== "object") return null;
  const { role, expiresAt } = body as Record<string, unknown>;
  if (!isUserRole(role) || typeof expiresAt !== "string") return null;
  return { role, expiresAt };
}

export function createAuthApi(options: AuthApiOptions = {}) {
  const base = (options.baseUrl ?? "").replace(/\/+$/, "");
  const doFetch = (path: string, init: RequestInit) =>
    (options.fetch ?? fetch)(`${base}${path}`, { credentials: "same-origin", ...init });

  async function call<T>(
    path: string,
    init: RequestInit,
    pick: (body: unknown) => T | null,
  ): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await doFetch(path, init);
    } catch {
      return networkFailure();
    }
    const body = await readJson(res);
    if (!res.ok) return failure(res.status, body);
    const data = pick(body);
    return data === null
      ? { ok: false, status: res.status, code: "bad_response" }
      : { ok: true, data };
  }

  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  const ok = () => true as const;

  return {
    getConfig: () =>
      call<AuthConfig>("/api/auth-config", { headers: { accept: "application/json" } }, (b) => {
        if (!b || typeof b !== "object") return null;
        const { hasUsers, githubEnabled, openSignup } = b as Record<string, unknown>;
        return {
          hasUsers: hasUsers === true,
          githubEnabled: githubEnabled === true,
          openSignup: openSignup === true,
        };
      }),

    signIn: ({ email, password }: Credentials) =>
      call("/api/auth/sign-in/email", post({ email, password }), ok),

    /** Open registration: the office's first account (becomes owner) or OFFICE_OPEN_SIGNUP. */
    signUp: ({ name, email, password }: Registration) =>
      call("/api/auth/sign-up/email", post({ name, email, password }), ok),

    signOut: () => call("/api/auth/sign-out", post({}), ok),

    /** Start GitHub OAuth; resolves to the provider URL the browser must navigate to. */
    githubSignIn: () =>
      call(
        "/api/auth/sign-in/social",
        post({ provider: "github", callbackURL: "/office", errorCallbackURL: "/login" }),
        (b) => {
          const url = b && typeof b === "object" ? (b as { url?: unknown }).url : undefined;
          return typeof url === "string" ? url : null;
        },
      ),

    me: () =>
      call<SessionUser>("/api/me", { headers: { accept: "application/json" } }, parseSessionUser),

    getInvite: (token: string) =>
      call(
        `/api/invites/${encodeURIComponent(token)}`,
        { headers: { accept: "application/json" } },
        parseInvite,
      ),

    createInvite: (role: UserRole) =>
      call<CreatedInvite>("/api/invites", post({ role }), (b) => {
        const info = parseInvite(b);
        const { id, url } = (b ?? {}) as Record<string, unknown>;
        if (!info || typeof id !== "string" || typeof url !== "string") return null;
        return { ...info, id, url };
      }),

    /** Register through an invite; the server signs the browser in and applies the role. */
    join: (token: string, { name, email, password }: Registration) =>
      call<SessionUser>(
        `/api/join/${encodeURIComponent(token)}`,
        post({ name, email, password }),
        parseSessionUser,
      ),
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;

/** The page's client: same origin as the page, which is where the server serves the app. */
export const authApi: AuthApi = createAuthApi();

/** Human wording for a failed auth call; never echoes anything the user typed. */
export function describeAuthError(err: ApiFailure): string {
  switch (err.code) {
    case "network_error":
      return "Could not reach the office server. Check your connection and try again.";
    case "rate_limited":
      return `Too many attempts. Try again in ${err.retryAfterSeconds ?? 60} seconds.`;
    case "invalid_email_or_password":
      return "Email or password is incorrect.";
    case "signup_closed":
      return "Registration is by invite only. Ask an owner or admin for an invite link.";
    case "user_already_exists":
    case "user_already_exists_use_another_email":
      return "An account with this email already exists. Sign in instead.";
    case "password_too_short":
      return "Password must be at least 8 characters.";
    case "password_too_long":
      return "Password is too long.";
    case "invalid_email":
      return "Enter a valid email address.";
    case "invalid_body":
      return "Some fields are missing or invalid.";
    case "invite_invalid":
      return describeInviteRejection(err.reason);
    case "owner_required":
      return "Only the owner can invite another owner.";
    case "forbidden":
      return "You do not have permission to do that.";
    case "unauthorized":
      return "Your session has ended. Sign in again.";
    case "origin_mismatch":
      return "The request came from an unexpected origin; reload the page from the office URL.";
    default:
      return err.status >= 500
        ? "The office server had a problem. Try again in a moment."
        : "Something went wrong. Try again.";
  }
}

export function describeInviteRejection(reason: string | undefined): string {
  switch (reason) {
    case "expired":
      return "This invite link has expired. Ask for a new one.";
    case "used":
      return "This invite link has already been used. Ask for a new one.";
    default:
      return "This invite link is not valid. Check that you copied all of it.";
  }
}
