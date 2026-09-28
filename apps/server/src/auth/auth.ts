/**
 * Better Auth instance for the office (SPEC §4.2 Auth; research 01 §8):
 * bun:sqlite through the Drizzle adapter, email + password, GitHub social
 * login when configured, sessions in the database, cookies prefixed `office`.
 *
 * Office roles are not a Better Auth concern: a database hook creates the
 * `user_profiles` row on registration (first human becomes owner, see
 * ./roles.ts) and {@link OfficeAuth.getSessionFromRequest} joins it back in.
 */

import type { UserRole } from "@regulus/protocol";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { OfficeConfig } from "../config.ts";
import type { Db } from "../db/index.ts";
import * as schema from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import { ensureProfile } from "./roles.ts";

export const AUTH_BASE_PATH = "/api/auth";
export const COOKIE_PREFIX = "office";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AuthDeps {
  db: Db;
  logger: Logger;
  config: Pick<OfficeConfig, "betterAuthSecret" | "publicUrl" | "githubOAuth">;
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
  sessionId: string;
  sessionExpiresAt: Date;
}

export class AuthConfigError extends Error {
  override name = "AuthConfigError";
}

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
  readonly now: () => number;
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
        fn.call(logger, { betterAuth: true, detail: args.length ? args : undefined }, message);
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
    now,
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
