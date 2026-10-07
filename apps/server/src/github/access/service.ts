/**
 * A person's GitHub access (SPEC D26, D27; #267): the one place the office
 * asks "what may this person see". Answers come from the snapshot in the
 * database; GitHub is only called by a refresh (after linking, on sign-in, on
 * a timer, on a webhook, on "check now"), never on a request path.
 *
 *   access.repoPermissionFor(userId, repoId)   // "none" | "read" | ... | "admin"
 *   access.roomAccessFor(userId, repoId)       // "view" | "spawn" | "manage" | null
 *   access.levelsVisibleTo(userId)             // one entry per org/account with a visible repo
 *   access.events.on("access-changed", ...)    // #244, #270
 *
 * Office roles give nothing here (D27): an owner without GitHub access to a
 * repo gets `none` like anyone else. A person who has not linked, or whose
 * token GitHub refused, has an empty snapshot: the lobby only.
 */
import {
  type GitHubLinkStatus,
  type GitHubRepoPermission,
  type OperationAccess,
  operationAccessForRepoPermission,
} from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import { type AccessGitHub, AccessGitHubError, type OAuthClient } from "./client.ts";
import { AccessEventBus } from "./events.ts";
import { type AccessStore, AccessStoreError, type OfficeRepo, type UserTokens } from "./store.ts";

/** Refresh a GitHub App user token this long before it expires. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
const REPO_CONCURRENCY = 4;

/** An organisation or personal account with at least one repo the person can see (D26). */
export interface VisibleLevel {
  /** The owner login as the office's repos spell it. */
  owner: string;
  /** Lower-case owner login: the key to compare with. */
  key: string;
  /** Office repo ids on this level the person can see, i.e. the rooms they may enter. */
  repoIds: string[];
}

export class LinkError extends Error {
  override name = "LinkError";
  constructor(
    readonly code:
      | "oauth_not_configured"
      | "master_key_required"
      | "github_rejected"
      | "github_unavailable"
      | "account_in_use",
    readonly detail = "",
  ) {
    super(code);
  }
}

export type RefreshOutcome =
  /** No link, or it is revoked: nothing to ask GitHub. */
  | { state: "not_linked" }
  | { state: "revoked"; repoIds: string[] }
  /** `error`: what GitHub could not answer (the rest of the snapshot is current). */
  | { state: "refreshed"; changed: string[]; error: string | null };

export interface AccessServiceDeps {
  store: AccessStore;
  github: AccessGitHub;
  /** The OAuth client people authorise, or null when the office has none. */
  oauthClient(): OAuthClient | null;
  logger: Logger;
  now?: () => number;
}

const repoKey = (r: { owner: string; name: string }) =>
  `${r.owner.toLowerCase()}/${r.name.toLowerCase()}`;

async function inBatches<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export class GitHubAccessService {
  readonly events: AccessEventBus;
  readonly #d: AccessServiceDeps;
  readonly #now: () => number;
  /** One refresh at a time per user; later ones queue behind it. */
  readonly #chains = new Map<string, Promise<unknown>>();

  constructor(deps: AccessServiceDeps) {
    this.#d = deps;
    this.#now = deps.now ?? Date.now;
    this.events = new AccessEventBus(deps.logger);
  }

  // ---- The snapshot (request path: database only) ---------------------------------

  /** The person's GitHub permission on an office repo, from the snapshot. */
  repoPermissionFor(userId: string, repoId: string): GitHubRepoPermission {
    return this.#d.store.permission(userId, repoId);
  }

  /** What that permission lets the person do in the repo's room, or null: the room is closed. */
  roomAccessFor(userId: string, repoId: string): OperationAccess | null {
    return operationAccessForRepoPermission(this.repoPermissionFor(userId, repoId));
  }

  /** Every office repo the person can see, with its permission. */
  visibleRepos(userId: string): Map<string, GitHubRepoPermission> {
    return this.#d.store.permissions(userId);
  }

  /**
   * The levels the person can reach (D26): the organisations and accounts
   * owning at least one office repo they can see. The lobby is everyone's
   * and is not listed. Empty without a link.
   */
  levelsVisibleTo(userId: string): VisibleLevel[] {
    const visible = this.#d.store.permissions(userId);
    if (visible.size === 0) return [];
    const levels = new Map<string, VisibleLevel>();
    for (const repo of this.#d.store.officeRepos()) {
      if (!visible.has(repo.id)) continue;
      const key = repo.owner.toLowerCase();
      const level = levels.get(key) ?? { owner: repo.owner, key, repoIds: [] };
      level.repoIds.push(repo.id);
      levels.set(key, level);
    }
    return [...levels.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** The person's organisations (lower-case logins), from the snapshot. */
  organizationsOf(userId: string): string[] {
    return this.#d.store.memberships(userId).map((m) => m.login);
  }

  /** The office user who linked this GitHub account (webhooks name people by GitHub id). */
  userIdForGitHubUser(githubUserId: number): string | null {
    return this.#d.store.userIdForGitHubUser(githubUserId);
  }

  linkedUserIds(): string[] {
    return this.#d.store.linkedUserIds();
  }

  /** Why nobody can link on this office, or null. */
  unavailableReason(): "oauth_not_configured" | "master_key_required" | null {
    if (!this.#d.oauthClient()) return "oauth_not_configured";
    if (!this.#d.store.canStore) return "master_key_required";
    return null;
  }

  /** What Settings shows the person about their own link. Never a token. */
  status(userId: string): GitHubLinkStatus {
    const reason = this.unavailableReason();
    const link = this.#d.store.link(userId);
    const visible = this.#d.store.permissions(userId);
    const repos = this.#d.store
      .officeRepos()
      .flatMap((repo) => {
        const permission = visible.get(repo.id);
        const access = permission ? operationAccessForRepoPermission(permission) : null;
        if (!permission || !access) return [];
        return [{ repoId: repo.id, fullName: `${repo.owner}/${repo.name}`, permission, access }];
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return {
      available: reason === null,
      unavailableReason: reason,
      state: link ? link.status : "not_linked",
      login: link?.login ?? null,
      linkedAt: link?.linkedAt ?? null,
      lastCheckedAt: link?.lastCheckedAt ?? null,
      lastError: link?.lastError?.slice(0, 300) ?? null,
      organizations: this.organizationsOf(userId),
      repos,
    };
  }

  // ---- Linking -------------------------------------------------------------------

  #client(): OAuthClient {
    const reason = this.unavailableReason();
    if (reason) throw new LinkError(reason);
    return this.#d.oauthClient() as OAuthClient;
  }

  /** The github.com page where the person authorises the link. */
  authorizeUrl(state: string, redirectUri: string): string {
    return this.#d.github.authorizeUrl(this.#client(), state, redirectUri);
  }

  /**
   * The OAuth callback: exchange the code, find out whose token it is, store
   * it encrypted and take the first snapshot. One GitHub account links to one
   * office user.
   */
  async completeLink(userId: string, code: string, redirectUri: string): Promise<void> {
    const client = this.#client();
    let tokens: UserTokens;
    let viewer: { id: number; login: string };
    try {
      tokens = await this.#d.github.exchangeCode(client, code, redirectUri);
      viewer = await this.#d.github.viewer(tokens.accessToken);
    } catch (err) {
      const e = err instanceof AccessGitHubError ? err : null;
      throw new LinkError(
        e?.kind === "rejected" ? "github_rejected" : "github_unavailable",
        e?.detail ?? "",
      );
    }
    const holder = this.#d.store.userIdForGitHubUser(viewer.id);
    if (holder !== null && holder !== userId) throw new LinkError("account_in_use");
    await this.#serial(userId, async () => {
      const before = this.#d.store.link(userId);
      // Another GitHub account than before: what the old one could see is not this one's.
      if (before && before.githubUserId !== viewer.id) this.#drop(userId, "unlinked");
      this.#d.store.saveLink(
        userId,
        { githubUserId: viewer.id, login: viewer.login },
        tokens,
        this.#now(),
      );
    });
    this.#d.logger.info({ userId, login: viewer.login }, "github account linked");
    await this.refreshUser(userId);
  }

  /** Unlink: the token and the snapshot go; the person is back to the lobby only. */
  async unlink(userId: string): Promise<boolean> {
    return this.#serial(userId, async () => {
      const lost = this.#d.store.remove(userId);
      if (lost === null) return false;
      this.#d.logger.info({ userId }, "github account unlinked");
      this.#emit(userId, lost, "unlinked");
      return true;
    });
  }

  // ---- Refreshing ----------------------------------------------------------------

  /**
   * Ask GitHub what the person can see now and update the snapshot.
   * `repoIds` limits the repo checks (a webhook about one repo); organisation
   * memberships and the token itself are checked every time.
   */
  refreshUser(userId: string, opts: { repoIds?: readonly string[] } = {}): Promise<RefreshOutcome> {
    return this.#serial(userId, () => this.#refresh(userId, opts.repoIds));
  }

  /** Refresh everyone who is linked, one person after another. */
  async refreshAll(opts: { repoIds?: readonly string[] } = {}): Promise<void> {
    for (const userId of this.#d.store.linkedUserIds()) {
      try {
        await this.refreshUser(userId, opts);
      } catch (err) {
        this.#d.logger.error({ userId, err }, "refreshing github access failed");
      }
    }
  }

  #serial<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#chains.get(userId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.#chains.set(userId, tail);
    void tail.then(() => {
      if (this.#chains.get(userId) === tail) this.#chains.delete(userId);
    });
    return next;
  }

  #emit(userId: string, repoIds: string[], reason: "refresh" | "revoked" | "unlinked"): void {
    if (repoIds.length === 0) return;
    this.events.emit("access-changed", { userId, repoIds: [...new Set(repoIds)].sort(), reason });
  }

  /** Empty the snapshot and the token, keeping a `revoked` row. */
  #drop(
    userId: string,
    reason: "revoked" | "unlinked",
    detail = "GitHub no longer accepts the link",
  ): string[] {
    const lost = this.#d.store.revoke(userId, this.#now(), detail.slice(0, 300));
    this.#emit(userId, lost, reason);
    return lost;
  }

  #revoked(userId: string, detail: string): RefreshOutcome {
    const repoIds = this.#drop(userId, "revoked", detail);
    this.#d.logger.warn(
      { userId, detail },
      "github link revoked or expired; access snapshot dropped",
    );
    return { state: "revoked", repoIds };
  }

  /** A usable access token: the stored one, or a new one from the refresh token when it expired. */
  async #usableToken(userId: string, tokens: UserTokens): Promise<string> {
    const now = this.#now();
    if (tokens.expiresAt === null || tokens.expiresAt - EXPIRY_MARGIN_MS > now) {
      return tokens.accessToken;
    }
    const client = this.#d.oauthClient();
    const refreshUsable =
      tokens.refreshToken !== null &&
      (tokens.refreshExpiresAt === null || tokens.refreshExpiresAt > now);
    if (!client || !refreshUsable) {
      // Still inside its lifetime: use it; GitHub says 401 once it is really over.
      if (tokens.expiresAt > now) return tokens.accessToken;
      throw new AccessGitHubError("rejected", "the GitHub token expired");
    }
    const fresh = await this.#d.github.refresh(client, tokens.refreshToken as string);
    this.#d.store.updateTokens(userId, fresh);
    return fresh.accessToken;
  }

  async #refresh(userId: string, only: readonly string[] | undefined): Promise<RefreshOutcome> {
    const { store, github } = this.#d;
    const link = store.link(userId);
    if (!link || link.status !== "linked") return { state: "not_linked" };
    let token: string;
    let viewer: { id: number; login: string };
    try {
      const stored = store.openTokens(userId);
      if (!stored) return this.#revoked(userId, "the link has no token");
      token = await this.#usableToken(userId, stored);
      viewer = await github.viewer(token);
    } catch (err) {
      if (err instanceof AccessStoreError && err.code === "undecryptable") {
        return this.#revoked(userId, "the stored token cannot be decrypted");
      }
      return this.#failed(userId, err);
    }
    if (viewer.id !== link.githubUserId) {
      return this.#revoked(userId, "the token belongs to another GitHub account");
    }

    const errors: string[] = [];
    try {
      store.replaceMemberships(userId, await github.orgs(token));
    } catch (err) {
      if (err instanceof AccessGitHubError && err.kind === "rejected") {
        return this.#revoked(userId, err.detail);
      }
      // Without the organisation permission GitHub refuses this list; repos are still checked.
      errors.push(`organisations: ${err instanceof AccessGitHubError ? err.detail : "failed"}`);
    }

    const wanted = only ? new Set(only) : null;
    const repos = store.officeRepos().filter((r) => !wanted || wanted.has(r.id));
    // Several rooms may follow the same GitHub repo: ask once per repo.
    const byRepo = new Map<string, OfficeRepo[]>();
    for (const repo of repos)
      byRepo.set(repoKey(repo), [...(byRepo.get(repoKey(repo)) ?? []), repo]);
    const checked = new Map<string, GitHubRepoPermission>();
    let rejected: AccessGitHubError | null = null;
    let unavailable = 0;
    await inBatches([...byRepo.values()], REPO_CONCURRENCY, async (rows) => {
      const first = rows[0] as OfficeRepo;
      if (rejected) return;
      try {
        const permission = await github.repoPermission(token, first.owner, first.name);
        for (const row of rows) checked.set(row.id, permission);
      } catch (err) {
        if (err instanceof AccessGitHubError && err.kind === "rejected") rejected = err;
        else unavailable += 1;
      }
    });
    if (rejected) return this.#revoked(userId, (rejected as AccessGitHubError).detail);
    if (unavailable > 0) {
      errors.push(`GitHub could not answer for ${unavailable} repo${unavailable === 1 ? "" : "s"}`);
    }

    const before = store.permissions(userId);
    const changed = [...checked]
      .filter(([id, p]) => (before.get(id) ?? "none") !== p)
      .map(([id]) => id);
    const now = this.#now();
    store.applyPermissions(userId, checked, now);
    const error = errors.length > 0 ? errors.join("; ").slice(0, 300) : null;
    store.markChecked(userId, now, error, viewer.login);
    this.#emit(userId, changed, "refresh");
    return { state: "refreshed", changed: changed.sort(), error };
  }

  #failed(userId: string, err: unknown): RefreshOutcome {
    if (err instanceof AccessGitHubError && err.kind === "rejected") {
      return this.#revoked(userId, err.detail);
    }
    const error = (
      err instanceof AccessGitHubError
        ? err.detail
        : err instanceof AccessStoreError
          ? err.code
          : "the check failed"
    ).slice(0, 300);
    if (!(err instanceof AccessGitHubError) && !(err instanceof AccessStoreError)) {
      this.#d.logger.error({ userId, err }, "refreshing github access failed");
    }
    // GitHub could not answer: what is known stays, and the next refresh tries again.
    this.#d.store.markChecked(userId, this.#now(), error);
    return { state: "refreshed", changed: [], error };
  }
}
