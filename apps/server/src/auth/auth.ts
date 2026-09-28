/**
 * Better Auth instance for the office (SPEC §4.2 Auth; research 01 §8):
 * bun:sqlite through the Drizzle adapter, email + password, GitHub social
 * login when configured, sessions in the database, cookies prefixed `office`.
 *
 * Office roles are not a Better Auth concern: a database hook creates the
 * `user_profiles` row on registration (first human becomes owner, see
 * ./roles.ts) and {@link OfficeAuth.getSessionFromRequest} joins it back in.
 */

import type { AvatarLook, UserRole } from "@regulus/protocol";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { count } from "drizzle-orm";
import type { OfficeConfig } from "../config.ts";
import type { Db } from "../db/index.ts";
import * as schema from "../db/schema/index.ts";
import { users } from "../db/schema/index.ts";
import { redactUrlsInText } from "../http/log-path.ts";
import type { Logger } from "../logging.ts";
import { ensureProfile } from "./roles.ts";

export const AUTH_BASE_PATH = "/api/auth";
export const COOKIE_PREFIX = "office";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AuthDeps {
  db: Db;
  logger: Logger;
  config: Pick<OfficeConfig, "betterAuthSecret" | "publicUrl" | "githubOAuth" | "openSignup">;
  /** Extra origins allowed to call the auth API and upgrade WebSockets (dev servers). */
  allowedOrigins?: readonly string[];
  /** Clock, overridable in tests (invite expiry, rate limits). */
  now?: () => number;
}

/** The signed-in human behind a request, ready for authorisation decisions. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  avatar: AvatarLook;
  sessionId: string;
  sessionExpiresAt: Date;
}

export class AuthConfigError extends Error {
  override name = "AuthConfigError";
}

/** Error code returned when registration is invite-only and no invite was presented. */
export const SIGNUP_CLOSED_CODE = "SIGNUP_CLOSED";

/**
 * Header the invite route adds when it calls Better Auth's sign-up on behalf
 * of a client. Its value is a random per-process nonce, so a client posting
 * to /api/auth/sign-up/email directly cannot forge it.
 */
const JOIN_HEADER = "x-office-join";

type BetterAuthInstance = ReturnType<typeof betterAuth>;

export interface OfficeAuth {
  /** Serves every Better Auth endpoint under {@link AUTH_BASE_PATH}. */
  readonly handler: (request: Request) => Promise<Response>;
  readonly api: BetterAuthInstance["api"];
  readonly db: Db;
  readonly logger: Logger;
  readonly publicUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly githubEnabled: boolean;
  readonly openSignup: boolean;
  readonly now: () => number;
  /** Copy of `headers` marked as coming through the invite route (see {@link SIGNUP_CLOSED_CODE}). */
  markJoinRequest(headers: Headers): Headers;
  /** Resolve the session cookie on any request (HTTP or WebSocket upgrade) to its user, or null. */
  getSessionFromRequest(request: Request): Promise<SessionUser | null>;
}

export function createAuth(deps: AuthDeps): OfficeAuth {
  const { db, logger, config } = deps;
  const now = deps.now ?? Date.now;
  if (!config.betterAuthSecret) {
    throw new AuthConfigError(
      "BETTER_AUTH_SECRET is not set; generate one with: openssl rand -base64 32",
    );
  }
  const publicUrl = new URL(config.publicUrl).origin;
  const allowedOrigins = deps.allowedOrigins ?? [];
  const github = config.githubOAuth;
  const joinNonce = crypto.randomUUID();

  const anyUserExists = (): boolean => {
    const [row] = db.select({ n: count() }).from(users).all();
    return (row?.n ?? 0) > 0;
  };

  const instance = betterAuth({
    appName: "Regulus Office",
    baseURL: publicUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.betterAuthSecret.expose(),
    trustedOrigins: [publicUrl, ...allowedOrigins],
    database: drizzleAdapter(db, { provider: "sqlite", schema, usePlural: true }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders: github
      ? { github: { clientId: github.clientId, clientSecret: github.clientSecret.expose() } }
      : {},
    session: { expiresIn: SESSION_TTL_SECONDS },
    // The office applies its own limiter (./rate-limit.ts) so custom routes share the policy.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    advanced: { cookiePrefix: COOKIE_PREFIX, database: { generateId: "uuid" } },
    databaseHooks: {
      user: {
        create: {
          /**
           * Invite-only after bootstrap: the first registration (any method)
           * is open so the owner can be created; later ones must come through
           * POST /api/join/:token unless OFFICE_OPEN_SIGNUP is set. Applies to
           * email and GitHub sign-ups alike since both create a user here.
           */
          before: async (_user, ctx) => {
            if (config.openSignup || !anyUserExists()) return;
            const headers = ctx?.headers ?? ctx?.request?.headers;
            if (headers?.get(JOIN_HEADER) === joinNonce) return;
            throw new APIError("FORBIDDEN", {
              code: SIGNUP_CLOSED_CODE,
              message: "Registration is by invite only; ask an owner or admin for an invite link",
            });
          },
          after: async (user) => {
            const { profile, created } = ensureProfile(db, user);
            if (created) logger.info({ userId: user.id, role: profile.role }, "user registered");
          },
        },
      },
    },
    logger: {
      level: "warn",
      log(level, message, ...args) {
        const fn = level === "error" ? logger.error : level === "warn" ? logger.warn : logger.debug;
        // Better Auth puts rejected redirect/callback URLs in its messages; strip
        // their query strings (OAuth code/state) and invite tokens (#90).
        const detail = args.map((a) => (typeof a === "string" ? redactUrlsInText(a) : a));
        fn.call(
          logger,
          { betterAuth: true, detail: detail.length ? detail : undefined },
          redactUrlsInText(message),
        );
      },
    },
  });

  const getSessionFromRequest = async (request: Request): Promise<SessionUser | null> => {
    const result = await instance.api.getSession({ headers: request.headers });
    if (!result) return null;
    const { profile } = ensureProfile(db, result.user);
    return {
      id: result.user.id,
      email: result.user.email,
      displayName: profile.displayName,
      role: profile.role,
      avatar: profile.avatar,
      sessionId: result.session.id,
      sessionExpiresAt: result.session.expiresAt,
    };
  };

  return {
    handler: (request) => instance.handler(request),
    api: instance.api,
    db,
    logger,
    publicUrl,
    allowedOrigins,
    githubEnabled: Boolean(github),
    openSignup: config.openSignup,
    now,
    markJoinRequest(headers) {
      const copy = new Headers(headers);
      copy.set(JOIN_HEADER, joinNonce);
      return copy;
    },
    getSessionFromRequest,
  };
}

/** Free-function form of {@link OfficeAuth.getSessionFromRequest} for callers holding the instance. */
export function getSessionFromRequest(
  auth: Pick<OfficeAuth, "getSessionFromRequest">,
  request: Request,
): Promise<SessionUser | null> {
  return auth.getSessionFromRequest(request);
}
