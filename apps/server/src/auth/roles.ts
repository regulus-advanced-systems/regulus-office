/**
 * Office roles (SPEC §2, §5, §8 rule 4): owner / admin / member / viewer stored
 * on `user_profiles`. The first registered human becomes owner; everyone else
 * starts as member unless an invite says otherwise. Role changes are
 * authorised here and written to the audit log.
 */
import {
  DEFAULT_GENIUS_LOOK,
  type GeniusLookValue,
  isUserRole,
  resolveGeniusLook,
  type UserRole,
} from "@regulus/protocol";
import { count, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { userProfiles } from "../db/schema/index.ts";
import { AUDIT_ACTIONS, type DbOrTx, writeAudit } from "./audit.ts";
import { AuthHttpError, forbidden } from "./errors.ts";

export interface Actor {
  id: string;
  role: UserRole;
}

export interface Profile {
  userId: string;
  displayName: string;
  role: UserRole;
  /** The human's genius (SPEC §5 `user_profiles.avatar`). */
  avatar: GeniusLookValue;
  /** False until the human confirmed a genius in the picker (first-login picker, #185). */
  avatarChosen: boolean;
}

/** Stored avatar JSON to a look; a corrupt or stale value falls back field by field. */
export function avatarFromColumn(json: string): GeniusLookValue {
  try {
    return resolveGeniusLook(JSON.parse(json));
  } catch {
    return { ...DEFAULT_GENIUS_LOOK };
  }
}

export const isAdminOrOwner = (role: UserRole): boolean => role === "owner" || role === "admin";

/** Display name shown in the office: the account name, else the email's local part. */
export function displayNameFor(user: { name?: string | null; email: string }): string {
  const name = user.name?.trim();
  return name && name.length > 0 ? name : (user.email.split("@")[0] ?? user.email);
}

export function getProfileByUserId(db: DbOrTx, userId: string): Profile | undefined {
  const row = db
    .select({
      userId: userProfiles.userId,
      displayName: userProfiles.displayName,
      role: userProfiles.role,
      avatar: userProfiles.avatar,
      avatarChosenAt: userProfiles.avatarChosenAt,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .get();
  if (!row || !isUserRole(row.role)) return undefined;
  return {
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    avatar: avatarFromColumn(row.avatar),
    avatarChosen: row.avatarChosenAt !== null,
  };
}

/**
 * Create the office profile for a freshly registered user. Race-safe: runs in
 * an IMMEDIATE transaction (bun:sqlite is synchronous, so the count and the
 * insert cannot interleave with another registration). The first profile in
 * the office gets `owner`; later ones default to `member`.
 */
export function ensureProfile(
  db: Db,
  user: { id: string; name?: string | null; email: string },
): { profile: Profile; created: boolean } {
  return db.transaction(
    (tx) => {
      const existing = getProfileByUserId(tx, user.id);
      if (existing) return { profile: existing, created: false };
      const [total] = tx.select({ n: count() }).from(userProfiles).all();
      const role: UserRole = (total?.n ?? 0) === 0 ? "owner" : "member";
      const displayName = displayNameFor(user);
      tx.insert(userProfiles).values({ userId: user.id, displayName, role }).run();
      if (role === "owner") {
        writeAudit(tx, {
          userId: user.id,
          action: AUDIT_ACTIONS.bootstrapOwner,
          targetKind: "user",
          targetId: user.id,
          meta: { role },
        });
      }
      return {
        profile: {
          userId: user.id,
          displayName,
          role,
          avatar: { ...DEFAULT_GENIUS_LOOK },
          avatarChosen: false,
        },
        created: true,
      };
    },
    { behavior: "immediate" },
  );
}

/**
 * Who may set which role. Admins and owners manage roles; only an owner may
 * grant `owner` or touch an existing owner; nobody edits their own role (so
 * the last owner cannot lock the office).
 */
export function assertCanAssignRole(actor: Actor, target: Actor, next: UserRole): void {
  if (!isAdminOrOwner(actor.role)) throw forbidden();
  if (actor.id === target.id) throw forbidden("cannot_change_own_role");
  if ((next === "owner" || target.role === "owner") && actor.role !== "owner") {
    throw forbidden("owner_required");
  }
}

/** Admins and owners may invite; only an owner may mint an `owner` invite. */
export function assertCanInviteRole(actor: Actor, role: UserRole): void {
  if (!isAdminOrOwner(actor.role)) throw forbidden();
  if (role === "owner" && actor.role !== "owner") throw forbidden("owner_required");
}

export interface RoleChange {
  userId: string;
  previousRole: UserRole;
  role: UserRole;
}

/** Change a user's role on behalf of `actor`, enforcing {@link assertCanAssignRole} and auditing. */
export function setUserRole(
  db: Db,
  actor: Actor,
  targetUserId: string,
  next: UserRole,
): RoleChange {
  return db.transaction(
    (tx) => {
      const target = getProfileByUserId(tx, targetUserId);
      if (!target) throw new AuthHttpError(404, "user_not_found");
      assertCanAssignRole(actor, { id: target.userId, role: target.role }, next);
      if (target.role !== next) {
        tx.update(userProfiles)
          .set({ role: next })
          .where(eq(userProfiles.userId, targetUserId))
          .run();
        writeAudit(tx, {
          userId: actor.id,
          action: AUDIT_ACTIONS.roleChange,
          targetKind: "user",
          targetId: targetUserId,
          meta: { from: target.role, to: next },
        });
      }
      return { userId: targetUserId, previousRole: target.role, role: next };
    },
    { behavior: "immediate" },
  );
}
