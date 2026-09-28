/**
 * Single-use invite links (SPEC §4.2 Auth, §5 `invites`): an admin or owner
 * mints a token bound to a role; it expires after 7 days and is consumed by
 * exactly one sign-up. Tokens are random and only ever returned to the person
 * who created them; they are never logged.
 */
import { isUserRole, type UserRole } from "@regulus/protocol";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { invites, userProfiles } from "../db/schema/index.ts";
import { AUDIT_ACTIONS, type DbOrTx, writeAudit } from "./audit.ts";
import { type Actor, assertCanInviteRole } from "./roles.ts";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

export interface Invite {
  id: string;
  token: string;
  role: UserRole;
  expiresAt: Date;
}

export type InviteRejection = "not_found" | "expired" | "used";

export type InviteLookup =
  | { ok: true; invite: Omit<Invite, "token"> }
  | { ok: false; reason: InviteRejection };

export function generateInviteToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))).toString("base64url");
}

/** Path (relative to the public URL) where the web client completes the sign-up. */
export const joinPathFor = (token: string): string => `/join/${token}`;

export function createInvite(
  db: Db,
  input: { actor: Actor; role: UserRole; now?: number },
): Invite {
  assertCanInviteRole(input.actor, input.role);
  const now = input.now ?? Date.now();
  const token = generateInviteToken();
  const expiresAt = new Date(now + INVITE_TTL_MS);
  return db.transaction((tx) => {
    const row = tx
      .insert(invites)
      .values({ token, role: input.role, expiresAt, createdBy: input.actor.id })
      .returning({ id: invites.id })
      .get();
    if (!row) throw new Error("insert invites returned nothing");
    writeAudit(tx, {
      userId: input.actor.id,
      action: AUDIT_ACTIONS.inviteCreate,
      targetKind: "invite",
      targetId: row.id,
      meta: { role: input.role, expiresAt: expiresAt.toISOString() },
    });
    return { id: row.id, token, role: input.role, expiresAt };
  });
}

/** Look an invite up without consuming it; says why it is unusable if it is. */
export function peekInvite(db: DbOrTx, token: string, now: number = Date.now()): InviteLookup {
  const row = db
    .select({
      id: invites.id,
      role: invites.role,
      expiresAt: invites.expiresAt,
      usedBy: invites.usedBy,
    })
    .from(invites)
    .where(eq(invites.token, token))
    .get();
  if (!row || !isUserRole(row.role)) return { ok: false, reason: "not_found" };
  if (row.usedBy !== null) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= now) return { ok: false, reason: "expired" };
  return { ok: true, invite: { id: row.id, role: row.role, expiresAt: row.expiresAt } };
}

export type InviteClaim = { ok: true; role: UserRole } | { ok: false; reason: InviteRejection };

/**
 * Atomically mark the invite used by `userId` and apply its role to that
 * user's profile. A single UPDATE guarded by `used_by IS NULL AND expires_at >
 * now` inside an IMMEDIATE transaction makes two concurrent claims resolve to
 * exactly one winner.
 */
export function claimInvite(
  db: Db,
  input: { token: string; userId: string; now?: number },
): InviteClaim {
  const now = input.now ?? Date.now();
  return db.transaction(
    (tx) => {
      const claimed = tx
        .update(invites)
        .set({ usedBy: input.userId, usedAt: new Date(now) })
        .where(
          and(
            eq(invites.token, input.token),
            isNull(invites.usedBy),
            gt(invites.expiresAt, new Date(now)),
          ),
        )
        .returning({ id: invites.id, role: invites.role })
        .get();
      if (!claimed || !isUserRole(claimed.role)) {
        const why = peekInvite(tx, input.token, now);
        return { ok: false, reason: why.ok ? "used" : why.reason };
      }
      tx.update(userProfiles)
        .set({ role: claimed.role })
        .where(eq(userProfiles.userId, input.userId))
        .run();
      writeAudit(tx, {
        userId: input.userId,
        action: AUDIT_ACTIONS.inviteConsume,
        targetKind: "invite",
        targetId: claimed.id,
        meta: { role: claimed.role },
      });
      return { ok: true, role: claimed.role };
    },
    { behavior: "immediate" },
  );
}
