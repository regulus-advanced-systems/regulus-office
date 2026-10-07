/**
 * Storage for a person's GitHub link and access snapshot (SPEC §8, D27; #267).
 *
 * The user token and its refresh token are envelope-encrypted by the secrets
 * module with the AAD bound to the office user and the column
 * (`github_link:<userId>|<secret>`), so a ciphertext copied onto another
 * user's row does not decrypt. Plain tokens leave this module only through
 * {@link AccessStore.openTokens}, for one server-side call to GitHub.
 */
import type { GitHubRepoPermission } from "@regulus/protocol";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import {
  githubOrgMemberships,
  githubRepoPermissions,
  githubUserLinks,
  operationRepos,
} from "../../db/schema/index.ts";
import {
  decryptSecretToString,
  encryptSecret,
  type MasterKeyring,
  type SecretContext,
} from "../../secrets/index.ts";

export type LinkSecret = "user_token" | "user_refresh_token";

export function linkSecretContext(userId: string, secret: LinkSecret): SecretContext {
  return { userId: `github_link:${userId}`, secretName: secret };
}

/** A link row without its ciphertexts. */
export interface LinkRecord {
  userId: string;
  githubUserId: number;
  login: string;
  status: "linked" | "revoked";
  hasToken: boolean;
  tokenExpiresAt: number | null;
  refreshTokenExpiresAt: number | null;
  linkedAt: number;
  lastCheckedAt: number | null;
  lastError: string | null;
}

/** What GitHub handed out for a user: the token, and for GitHub Apps its expiry and refresh token. */
export interface UserTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
}

export interface OfficeRepo {
  id: string;
  operationId: string;
  owner: string;
  name: string;
}

export interface OrgMembership {
  login: string;
  id: number | null;
  role: string;
}

export class AccessStoreError extends Error {
  override name = "AccessStoreError";
  constructor(readonly code: "master_key_required" | "undecryptable") {
    super(code);
  }
}

type LinkRow = typeof githubUserLinks.$inferSelect;

const record = (row: LinkRow): LinkRecord => ({
  userId: row.userId,
  githubUserId: row.githubUserId,
  login: row.login,
  status: row.status,
  hasToken: row.encryptedToken !== null,
  tokenExpiresAt: row.tokenExpiresAt?.getTime() ?? null,
  refreshTokenExpiresAt: row.refreshTokenExpiresAt?.getTime() ?? null,
  linkedAt: row.linkedAt.getTime(),
  lastCheckedAt: row.lastCheckedAt?.getTime() ?? null,
  lastError: row.lastError,
});

const date = (ms: number | null) => (ms === null ? null : new Date(ms));

export class AccessStore {
  readonly #db: Db;
  readonly #keyring: MasterKeyring | undefined;

  constructor(db: Db, keyring: MasterKeyring | undefined) {
    this.#db = db;
    this.#keyring = keyring;
  }

  /** False without OFFICE_MASTER_KEY: a token cannot be stored, so nobody can link. */
  get canStore(): boolean {
    return this.#keyring !== undefined;
  }

  #ring(): MasterKeyring {
    if (!this.#keyring) throw new AccessStoreError("master_key_required");
    return this.#keyring;
  }

  #seal(userId: string, secret: LinkSecret, value: string): string {
    const ring = this.#ring();
    return encryptSecret(value, linkSecretContext(userId, secret), ring.keys, ring.current);
  }

  #open(userId: string, secret: LinkSecret, envelope: string): string {
    const ring = this.#ring();
    try {
      return decryptSecretToString(envelope, linkSecretContext(userId, secret), ring.keys);
    } catch {
      throw new AccessStoreError("undecryptable");
    }
  }

  #row(userId: string): LinkRow | undefined {
    return this.#db.select().from(githubUserLinks).where(eq(githubUserLinks.userId, userId)).get();
  }

  link(userId: string): LinkRecord | null {
    const row = this.#row(userId);
    return row ? record(row) : null;
  }

  /** The office user who linked this GitHub account, by GitHub's numeric id. */
  userIdForGitHubUser(githubUserId: number): string | null {
    const row = this.#db
      .select({ userId: githubUserLinks.userId })
      .from(githubUserLinks)
      .where(eq(githubUserLinks.githubUserId, githubUserId))
      .get();
    return row?.userId ?? null;
  }

  /** Everyone whose snapshot is kept current. */
  linkedUserIds(): string[] {
    return this.#db
      .select({ userId: githubUserLinks.userId })
      .from(githubUserLinks)
      .where(eq(githubUserLinks.status, "linked"))
      .all()
      .map((r) => r.userId);
  }

  #tokenColumns(userId: string, tokens: UserTokens) {
    return {
      encryptedToken: this.#seal(userId, "user_token", tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? this.#seal(userId, "user_refresh_token", tokens.refreshToken)
        : null,
      tokenExpiresAt: date(tokens.expiresAt),
      refreshTokenExpiresAt: date(tokens.refreshExpiresAt),
    };
  }

  /** Create or replace the user's link (linking again after a revocation, or another account). */
  saveLink(
    userId: string,
    account: { githubUserId: number; login: string },
    tokens: UserTokens,
    now: number,
  ): void {
    const values = {
      githubUserId: account.githubUserId,
      login: account.login,
      status: "linked" as const,
      ...this.#tokenColumns(userId, tokens),
      linkedAt: new Date(now),
      lastCheckedAt: null,
      lastError: null,
    };
    this.#db
      .insert(githubUserLinks)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: githubUserLinks.userId,
        set: { ...values, updatedAt: new Date(now) },
      })
      .run();
  }

  /** The tokens, decrypted for one use; null when the link has none (revoked or never linked). */
  openTokens(userId: string): UserTokens | null {
    const row = this.#row(userId);
    if (!row?.encryptedToken) return null;
    return {
      accessToken: this.#open(userId, "user_token", row.encryptedToken),
      refreshToken: row.encryptedRefreshToken
        ? this.#open(userId, "user_refresh_token", row.encryptedRefreshToken)
        : null,
      expiresAt: row.tokenExpiresAt?.getTime() ?? null,
      refreshExpiresAt: row.refreshTokenExpiresAt?.getTime() ?? null,
    };
  }

  /** Store the tokens a refresh grant returned. */
  updateTokens(userId: string, tokens: UserTokens): void {
    this.#db
      .update(githubUserLinks)
      .set(this.#tokenColumns(userId, tokens))
      .where(eq(githubUserLinks.userId, userId))
      .run();
  }

  markChecked(userId: string, now: number, error: string | null, login?: string): void {
    this.#db
      .update(githubUserLinks)
      .set({ lastCheckedAt: new Date(now), lastError: error, ...(login ? { login } : {}) })
      .where(eq(githubUserLinks.userId, userId))
      .run();
  }

  /**
   * GitHub refused the token: drop it and the whole snapshot in one
   * transaction. Returns the repo ids the person could see until now.
   */
  revoke(userId: string, now: number, reason: string): string[] {
    return this.#db.transaction((tx) => {
      const lost = tx
        .delete(githubRepoPermissions)
        .where(eq(githubRepoPermissions.userId, userId))
        .returning({ repoId: githubRepoPermissions.repoId })
        .all();
      tx.delete(githubOrgMemberships).where(eq(githubOrgMemberships.userId, userId)).run();
      tx.update(githubUserLinks)
        .set({
          status: "revoked",
          encryptedToken: null,
          encryptedRefreshToken: null,
          tokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          lastCheckedAt: new Date(now),
          lastError: reason,
        })
        .where(eq(githubUserLinks.userId, userId))
        .run();
      return lost.map((r) => r.repoId);
    });
  }

  /** Unlink: the row, the token and the snapshot all go. Returns the repo ids lost, or null when not linked. */
  remove(userId: string): string[] | null {
    return this.#db.transaction((tx) => {
      const lost = tx
        .delete(githubRepoPermissions)
        .where(eq(githubRepoPermissions.userId, userId))
        .returning({ repoId: githubRepoPermissions.repoId })
        .all();
      tx.delete(githubOrgMemberships).where(eq(githubOrgMemberships.userId, userId)).run();
      const removed = tx
        .delete(githubUserLinks)
        .where(eq(githubUserLinks.userId, userId))
        .returning({ id: githubUserLinks.id })
        .all();
      return removed.length > 0 ? lost.map((r) => r.repoId) : null;
    });
  }

  /** Every repo the office knows (operation repos). */
  officeRepos(): OfficeRepo[] {
    return this.#db
      .select({
        id: operationRepos.id,
        operationId: operationRepos.operationId,
        owner: operationRepos.owner,
        name: operationRepos.name,
      })
      .from(operationRepos)
      .all();
  }

  /** The user's snapshot: repo id → permission (never `none`). */
  permissions(userId: string): Map<string, GitHubRepoPermission> {
    const rows = this.#db
      .select({
        repoId: githubRepoPermissions.repoId,
        permission: githubRepoPermissions.permission,
      })
      .from(githubRepoPermissions)
      .where(eq(githubRepoPermissions.userId, userId))
      .all();
    return new Map(rows.map((r) => [r.repoId, r.permission]));
  }

  permission(userId: string, repoId: string): GitHubRepoPermission {
    const row = this.#db
      .select({ permission: githubRepoPermissions.permission })
      .from(githubRepoPermissions)
      .where(
        and(eq(githubRepoPermissions.userId, userId), eq(githubRepoPermissions.repoId, repoId)),
      )
      .get();
    return row?.permission ?? "none";
  }

  /** Write the checked repos' permissions (`none` deletes the row). */
  applyPermissions(
    userId: string,
    checked: ReadonlyMap<string, GitHubRepoPermission>,
    now: number,
  ): void {
    if (checked.size === 0) return;
    this.#db.transaction((tx) => {
      const gone = [...checked].filter(([, p]) => p === "none").map(([id]) => id);
      if (gone.length > 0) {
        tx.delete(githubRepoPermissions)
          .where(
            and(
              eq(githubRepoPermissions.userId, userId),
              inArray(githubRepoPermissions.repoId, gone),
            ),
          )
          .run();
      }
      for (const [repoId, permission] of checked) {
        if (permission === "none") continue;
        const set = { permission, checkedAt: new Date(now) };
        tx.insert(githubRepoPermissions)
          .values({ userId, repoId, ...set })
          .onConflictDoUpdate({
            target: [githubRepoPermissions.userId, githubRepoPermissions.repoId],
            set: { ...set, updatedAt: new Date(now) },
          })
          .run();
      }
    });
  }

  memberships(userId: string): OrgMembership[] {
    return this.#db
      .select()
      .from(githubOrgMemberships)
      .where(eq(githubOrgMemberships.userId, userId))
      .all()
      .map((r) => ({ login: r.orgLogin, id: r.orgId, role: r.role }))
      .sort((a, b) => a.login.localeCompare(b.login));
  }

  replaceMemberships(userId: string, orgs: readonly OrgMembership[]): void {
    this.#db.transaction((tx) => {
      tx.delete(githubOrgMemberships).where(eq(githubOrgMemberships.userId, userId)).run();
      const seen = new Set<string>();
      for (const org of orgs) {
        const orgLogin = org.login.toLowerCase();
        if (seen.has(orgLogin)) continue;
        seen.add(orgLogin);
        tx.insert(githubOrgMemberships)
          .values({ userId, orgLogin, orgId: org.id, role: org.role })
          .run();
      }
    });
  }
}
