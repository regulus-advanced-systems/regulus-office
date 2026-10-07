/**
 * Live access (#244; SPEC §11, D27): access is checked when a connection
 * opens, and withdrawn from open connections when it is lost.
 *
 * Every long-lived connection registers here when it opens (whiteboard,
 * terminal, laptop screen feed, proxied app WebSocket, BuildingRoom and
 * OperationRoom seats) with a `check` that repeats its own connect-time
 * decision for the human as they are now, and a `close`. Whoever changes what
 * a human may see calls {@link LiveAccess.accessChanged} with the humans
 * and/or operations it touched; each matching connection is checked again
 * and closed with one of the protocol's `ACCESS_CLOSE_CODES` when the answer
 * is no longer the one it was opened with. The rules stay where they are
 * (operations/access.ts, terminals/acl.ts, ...): this module only asks again.
 *
 *   const off = liveAccess.register({ kind, user, session, operationId, check, close });
 *   ...                                   // on socket close: off()
 *   liveAccess.accessChanged({ userId, operationIds });   // after any change
 *
 * A periodic sweep ({@link LiveAccess.startSweep}) asks about everything, so
 * an expired session or a change no caller reported still ends within a minute.
 */
import {
  ACCESS_CLOSE_CODES,
  ACCESS_CLOSE_REASONS,
  type AccessCloseKind,
  type UserRole,
} from "@regulus/protocol";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { sessions } from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import { getProfileByUserId } from "./roles.ts";

/** The human behind a connection, as far as access rules care. */
export interface AccessUser {
  id: string;
  role: UserRole;
}

/**
 * What a connection's own rule says now: `keep` (same access as at connect),
 * `changed` (still allowed, but differently: read-only now, another role) or
 * `revoked` (not allowed at all).
 */
export type AccessVerdict = "keep" | "changed" | "revoked";

/**
 * How the connection was authenticated: one Better Auth session (it ends
 * with that session), `any` (the human must still be signed in somewhere:
 * app-domain sockets carry only a user id) or `unchecked` (the development
 * header: no account behind it, so only `check` applies).
 */
export type SessionRef = { id: string } | "any" | "unchecked";

/** Session for a user object from `getSessionFromRequest` (which may be a test double without one). */
export const sessionRefOf = (user: { sessionId?: string }): SessionRef =>
  user.sessionId ? { id: user.sessionId } : "unchecked";

export interface LiveConnection {
  /** Bounded label for logs and tests: `whiteboard`, `terminal`, `room:operation`, ... */
  kind: string;
  /** The human as they were when the connection opened. */
  user: AccessUser;
  session: SessionRef;
  /** The operation this connection shows, or null when it is office-wide (lobby, building). */
  operationId: string | null;
  /** The connection's own id where it has one (a room seat's session id). */
  ref?: string;
  /** Repeat the connect-time decision for `user` as they are now. Must not throw for "no". */
  check(user: AccessUser): AccessVerdict;
  /** End the connection with a WebSocket close code and reason. */
  close(code: number, reason: string): void;
}

/** Which connections to look at: all of a human's, all on some operations, both, or (empty) all. */
export interface AccessScope {
  userId?: string;
  operationIds?: readonly string[];
}

/** Who a human is now; null when the account or the session behind the connection is gone. */
export type AccessSubjects = (userId: string, session: SessionRef) => AccessUser | null;

export interface LiveAccessOptions {
  subjects: AccessSubjects;
  logger: Logger;
  /** Called after a connection was ended here (e.g. to drop its media participant). */
  onEnded?(connection: LiveConnection, why: AccessCloseKind): void;
}

export interface AccessOutcome {
  checked: number;
  ended: number;
}

export class LiveAccess {
  readonly #connections = new Set<LiveConnection>();
  readonly #opts: LiveAccessOptions;

  constructor(options: LiveAccessOptions) {
    this.#opts = options;
  }

  /** Track an open connection; call the returned function when it closes. */
  register(connection: LiveConnection): () => void {
    this.#connections.add(connection);
    return () => {
      this.#connections.delete(connection);
    };
  }

  /** Open connections in `scope` (tests, metrics). */
  count(scope: AccessScope = {}): number {
    return this.#matching(scope).length;
  }

  /**
   * The entry point: something changed what these humans may see on these
   * operations (membership, role, archive or delete, sign-out, and later a
   * GitHub permission, #270). Call it after the change is stored. Every
   * matching connection is asked again and ended if the answer changed.
   * An empty scope asks about every connection.
   */
  accessChanged(scope: AccessScope = {}): AccessOutcome {
    const matching = this.#matching(scope);
    const subjects = new Map<string, AccessUser | null>();
    let ended = 0;
    for (const connection of matching) {
      const why = this.#verdict(connection, subjects);
      if (why === null) continue;
      this.#end(connection, why);
      ended += 1;
    }
    return { checked: matching.length, ended };
  }

  /**
   * End every connection in `scope` without asking, for a caller that knows
   * the access is gone before the stored rules say so.
   */
  end(scope: AccessScope, why: AccessCloseKind = "revoked"): number {
    const matching = this.#matching(scope);
    for (const connection of matching) this.#end(connection, why);
    return matching.length;
  }

  /** Ask about everything every `intervalMs`; returns the stop function. */
  startSweep(intervalMs: number): () => void {
    const timer = setInterval(() => {
      try {
        this.accessChanged();
      } catch (err) {
        this.#opts.logger.error({ err }, "live access sweep failed");
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  #matching(scope: AccessScope): LiveConnection[] {
    const operations = scope.operationIds ? new Set(scope.operationIds) : null;
    return [...this.#connections].filter(
      (c) =>
        (scope.userId === undefined || c.user.id === scope.userId) &&
        (operations === null || (c.operationId !== null && operations.has(c.operationId))),
    );
  }

  #verdict(
    connection: LiveConnection,
    subjects: Map<string, AccessUser | null>,
  ): AccessCloseKind | null {
    const { user, session } = connection;
    let now: AccessUser | null = user;
    if (session !== "unchecked") {
      const key = `${user.id}\n${session === "any" ? "" : session.id}`;
      if (!subjects.has(key)) subjects.set(key, this.#opts.subjects(user.id, session));
      now = subjects.get(key) ?? null;
    }
    if (!now) return "signedOut";
    let verdict: AccessVerdict;
    try {
      verdict = connection.check(now);
    } catch (err) {
      // A rule that cannot answer must not leave the connection open.
      this.#opts.logger.error({ err, kind: connection.kind }, "live access check failed");
      verdict = "revoked";
    }
    return verdict === "keep" ? null : verdict;
  }

  #end(connection: LiveConnection, why: AccessCloseKind): void {
    this.#connections.delete(connection);
    this.#opts.logger.info(
      {
        kind: connection.kind,
        userId: connection.user.id,
        operationId: connection.operationId,
        why,
      },
      "connection ended: access withdrawn",
    );
    try {
      connection.close(ACCESS_CLOSE_CODES[why], ACCESS_CLOSE_REASONS[why]);
    } catch (err) {
      this.#opts.logger.warn({ err, kind: connection.kind }, "closing a connection failed");
    }
    try {
      this.#opts.onEnded?.(connection, why);
    } catch (err) {
      this.#opts.logger.warn({ err, kind: connection.kind }, "live access onEnded failed");
    }
  }
}

/**
 * Subjects from the database: the profile must exist (a removed account has
 * none) and the session must still be there and unexpired (sign-out and
 * "sign out everywhere" delete session rows).
 */
export function dbAccessSubjects(db: Db, now: () => number = Date.now): AccessSubjects {
  return (userId, session) => {
    const profile = getProfileByUserId(db, userId);
    if (!profile) return null;
    if (session !== "unchecked") {
      const live = db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, userId),
            gt(sessions.expiresAt, new Date(now())),
            ...(session === "any" ? [] : [eq(sessions.id, session.id)]),
          ),
        )
        .limit(1)
        .get();
      if (!live) return null;
    }
    return { id: profile.userId, role: profile.role };
  };
}

/** How often {@link LiveAccess.startSweep} runs in the office (index.ts). */
export const LIVE_ACCESS_SWEEP_MS = 60_000;
