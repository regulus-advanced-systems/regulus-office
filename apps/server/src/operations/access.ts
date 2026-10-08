/**
 * Who may do what on an operation: the office's one access gate (SPEC §8
 * rule 4, §11; D26, D27; #251, #270). Every reader of operation or repo data
 * asks here, so the rule is in one place.
 *
 * A room opens with the person's own GitHub permission on its repo, read
 * from the snapshot kept by github/access (never from GitHub on a request):
 *
 * - No linked GitHub account, or a link GitHub refused: no room at all.
 * - `read`/`triage` → `view`, `write`/`maintain` → `spawn`, `admin` → `manage`
 *   (`operationAccessForRepoPermission` in the protocol); no permission, no room.
 * - **Office roles give nothing.** An owner or admin whose GitHub account
 *   cannot see a repo does not see its room either. Their role is for running
 *   the office (people, settings, shared agents, building rooms).
 * - An `operation_members` row no longer grants anything. It can only narrow:
 *   a person with a row gets the lower of the row and what GitHub gives.
 * - Office `viewer`s are capped at `view`.
 * - Archived or unknown operations give nothing; the lobby is not an operation.
 *
 * The one room GitHub cannot speak for is a room without a repo (created
 * before repos were required; it sits on the holding level and none can be
 * created any more). It has no repo content to protect, so it keeps the rule
 * it was created under: office owners and admins manage it, others need a
 * member row.
 */
import {
  type GitHubRepoPermission,
  LOBBY_LEVEL_ID,
  type OperationAccess,
  operationAccessForRepoPermission,
  type UserRole,
} from "@regulus/protocol";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import {
  githubRepoPermissions,
  githubUserLinks,
  operationMembers,
  operationRepos,
  operations,
} from "../db/schema/index.ts";

export interface OperationActor {
  id: string;
  role: UserRole;
}

export const isOfficeManager = (role: UserRole): boolean => role === "owner" || role === "admin";

const RANK: Readonly<Record<OperationAccess, number>> = { view: 1, spawn: 2, manage: 3 };

/** The lower of two accesses; null when either is missing. */
export function lowerAccess(
  a: OperationAccess | null,
  b: OperationAccess | null,
): OperationAccess | null {
  if (!a || !b) return null;
  return RANK[a] <= RANK[b] ? a : b;
}

/** What the office knows about one person and one room when it decides. */
export interface AccessFacts {
  role: UserRole;
  /** The person's GitHub link is in force (linked, not revoked). */
  linked: boolean;
  /**
   * Their permission on each repo of the room (one, D7), `none` where the
   * snapshot has no row. Empty for a room without a repo.
   */
  repoPermissions: readonly GitHubRepoPermission[];
  /** Their `operation_members` row, if any. */
  member: OperationAccess | null;
}

/** The rule itself, without the database (the header says what it is). */
export function decideOperationAccess(facts: AccessFacts): OperationAccess | null {
  let access: OperationAccess | null;
  if (facts.repoPermissions.length === 0) {
    access = isOfficeManager(facts.role) ? "manage" : facts.member;
  } else {
    if (!facts.linked) return null;
    access = "manage";
    for (const permission of facts.repoPermissions) {
      access = lowerAccess(access, operationAccessForRepoPermission(permission));
    }
    if (facts.member) access = lowerAccess(access, facts.member);
  }
  if (!access) return null;
  return facts.role === "viewer" ? "view" : access;
}

/** True when the person's GitHub link is in force. */
export function hasGitHubLink(db: DbOrTx, userId: string): boolean {
  const row = db
    .select({ status: githubUserLinks.status })
    .from(githubUserLinks)
    .where(eq(githubUserLinks.userId, userId))
    .get();
  return row?.status === "linked";
}

interface Decided {
  operationId: string;
  levelId: string;
  access: OperationAccess;
}

/** Decide for some operations at once (three queries whatever their number). */
function decide(
  db: DbOrTx,
  actor: OperationActor,
  opts: { operationId?: string; archived?: boolean },
): Decided[] {
  const state = opts.archived ? isNotNull(operations.archivedAt) : isNull(operations.archivedAt);
  const rows = db
    .select({
      operationId: operations.id,
      levelId: operations.levelId,
      repoId: operationRepos.id,
      permission: githubRepoPermissions.permission,
    })
    .from(operations)
    .leftJoin(operationRepos, eq(operationRepos.operationId, operations.id))
    .leftJoin(
      githubRepoPermissions,
      and(
        eq(githubRepoPermissions.repoId, operationRepos.id),
        eq(githubRepoPermissions.userId, actor.id),
      ),
    )
    .where(opts.operationId ? and(eq(operations.id, opts.operationId), state) : state)
    .all();
  if (rows.length === 0) return [];
  const linked = hasGitHubLink(db, actor.id);
  const ids = [...new Set(rows.map((r) => r.operationId))];
  const members = new Map(
    db
      .select({ operationId: operationMembers.operationId, access: operationMembers.access })
      .from(operationMembers)
      .where(and(eq(operationMembers.userId, actor.id), inArray(operationMembers.operationId, ids)))
      .all()
      .map((m) => [m.operationId, m.access]),
  );
  const byOperation = new Map<string, { levelId: string; permissions: GitHubRepoPermission[] }>();
  for (const row of rows) {
    const entry = byOperation.get(row.operationId) ?? { levelId: row.levelId, permissions: [] };
    if (row.repoId !== null) entry.permissions.push(row.permission ?? "none");
    byOperation.set(row.operationId, entry);
  }
  const out: Decided[] = [];
  for (const [operationId, entry] of byOperation) {
    const access = decideOperationAccess({
      role: actor.role,
      linked,
      repoPermissions: entry.permissions,
      member: members.get(operationId) ?? null,
    });
    if (access) out.push({ operationId, levelId: entry.levelId, access });
  }
  return out;
}

/** The actor's access to a live (non-archived) operation, or null. */
export function operationAccessFor(
  db: DbOrTx,
  actor: OperationActor,
  operationId: string,
): OperationAccess | null {
  return decide(db, actor, { operationId })[0]?.access ?? null;
}

/**
 * The access the actor would have to an archived operation were it live:
 * for the office managers' archive list, restore and delete, which must not
 * name a room whose repo the manager cannot see either.
 */
export function archivedOperationAccessFor(
  db: DbOrTx,
  actor: OperationActor,
  operationId: string,
): OperationAccess | null {
  return decide(db, actor, { operationId, archived: true })[0]?.access ?? null;
}

/** Every archived operation the actor could see were it live. */
export function accessibleArchivedOperations(
  db: DbOrTx,
  actor: OperationActor,
): Map<string, OperationAccess> {
  return new Map(decide(db, actor, { archived: true }).map((d) => [d.operationId, d.access]));
}

/** Every live operation open to the actor, with their access. */
export function accessibleOperations(
  db: DbOrTx,
  actor: OperationActor,
): Map<string, OperationAccess> {
  return new Map(decide(db, actor, {}).map((d) => [d.operationId, d.access]));
}

/** What one person may see of the lair (D26): the rooms they may enter and the levels they reach. */
export interface LairView {
  /** Live operations open to the person, with their access. */
  rooms: Map<string, OperationAccess>;
  /** The lobby level and every level with at least one room open to them. */
  levels: Set<string>;
  /** False without a GitHub link in force: the lobby only, and a prompt to link. */
  linked: boolean;
}

export function lairViewFor(db: DbOrTx, actor: OperationActor): LairView {
  const decided = decide(db, actor, {});
  return {
    rooms: new Map(decided.map((d) => [d.operationId, d.access])),
    levels: new Set([LOBBY_LEVEL_ID, ...decided.map((d) => d.levelId)]),
    linked: hasGitHubLink(db, actor.id),
  };
}

/** True when the actor has at least `need` on the live operation. */
export function hasOperationAccessTo(
  db: DbOrTx,
  actor: OperationActor,
  operationId: string,
  need: OperationAccess,
): boolean {
  const access = operationAccessFor(db, actor, operationId);
  return access !== null && RANK[access] >= RANK[need];
}

/**
 * The operations some repos belong to: what `access-changed` (repo ids)
 * means for rooms. Archived rooms included; their connections are closed anyway.
 */
export function operationIdsOfRepos(db: DbOrTx, repoIds: readonly string[]): string[] {
  if (repoIds.length === 0) return [];
  const rows = db
    .select({ operationId: operationRepos.operationId })
    .from(operationRepos)
    .where(inArray(operationRepos.id, [...repoIds]))
    .all();
  return [...new Set(rows.map((r) => r.operationId))];
}
