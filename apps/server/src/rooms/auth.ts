/**
 * Authentication seam for room joins (SPEC §6: joining requires a user;
 * SPEC §11: every state change is authorised server-side by role).
 *
 * The transport calls `RoomAuth.authenticate` with the matchmaking request,
 * so cookies and headers are available exactly as on any HTTP request.
 * Production uses {@link createSessionRoomAuth} over Better Auth's session
 * cookie; development composes the header auth behind it.
 */
import {
  type GeniusLookValue,
  resolveGeniusLook,
  USER_ROLES,
  type UserRole,
} from "@regulus/protocol";
import { z } from "zod";
import type { SessionUser } from "../auth/auth.ts";

export interface RoomAuthUser {
  userId: string;
  displayName: string;
  role: UserRole;
  avatar: GeniusLookValue;
  /** The Better Auth session behind the join; absent for the development header (#244). */
  sessionId?: string;
}

export interface RoomAuth {
  /** Resolves the user behind `request`, or `null` when it carries no valid session. */
  authenticate(request: Request): Promise<RoomAuthUser | null>;
}

/** Header carrying a JSON `RoomAuthUser` in development and tests only. */
export const DEV_USER_HEADER = "x-office-dev-user";

export const DevUserHeader = z.object({
  userId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(64),
  role: z.enum(USER_ROLES).default("member"),
  /** Any partial look; unknown fields fall back to the default genius. */
  avatar: z
    .unknown()
    .default({})
    .transform((raw) => resolveGeniusLook(raw)),
});

export const isProduction = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.NODE_ENV === "production";

/** Rejects every join. The safe default when no session lookup is available. */
export const denyAllAuth: RoomAuth = {
  authenticate: () => Promise.resolve(null),
};

/** The part of the office auth layer a room needs: the session cookie to user lookup. */
export interface SessionLookup {
  getSessionFromRequest(request: Request): Promise<SessionUser | null>;
}

/** Authenticates joins with the Better Auth session cookie (apps/server/src/auth). */
export function createSessionRoomAuth(sessions: SessionLookup): RoomAuth {
  return {
    async authenticate(request) {
      const user = await sessions.getSessionFromRequest(request);
      if (!user) return null;
      return {
        userId: user.id,
        displayName: user.displayName,
        role: user.role,
        avatar: user.avatar,
        sessionId: user.sessionId,
      };
    },
  };
}

/**
 * Accepts a `x-office-dev-user` header describing the user. Refuses to be
 * constructed in production so it can never be enabled there by accident.
 */
export function createDevHeaderAuth(env: NodeJS.ProcessEnv = process.env): RoomAuth {
  if (isProduction(env)) {
    throw new Error(`${DEV_USER_HEADER} auth must not be enabled in production`);
  }
  return {
    async authenticate(request) {
      const raw = request.headers.get(DEV_USER_HEADER);
      if (!raw) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      const result = DevUserHeader.safeParse(parsed);
      return result.success ? result.data : null;
    },
  };
}

/** Tries each auth in order; the first user wins. */
export function composeRoomAuth(auths: readonly RoomAuth[]): RoomAuth {
  return {
    async authenticate(request) {
      for (const auth of auths) {
        const user = await auth.authenticate(request);
        if (user) return user;
      }
      return null;
    },
  };
}
