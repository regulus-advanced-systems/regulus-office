/**
 * Read-only views of a person's GitHub snapshot (SPEC D26, D27; #267): the
 * levels they reach, and what Settings shows about their own link. Database
 * only; split from service.ts, which owns linking and refreshing.
 */
import { type GitHubLinkStatus, operationAccessForRepoPermission } from "@regulus/protocol";
import type { AccessStore } from "./store.ts";

/** An organisation or personal account with at least one repo the person can see (D26). */
export interface VisibleLevel {
  /** The owner login as the office's repos spell it. */
  owner: string;
  /** Lower-case owner login: the key to compare with. */
  key: string;
  /** Office repo ids on this level the person can see, i.e. the rooms they may enter. */
  repoIds: string[];
}

export function visibleLevels(store: AccessStore, userId: string): VisibleLevel[] {
  const visible = store.permissions(userId);
  if (visible.size === 0) return [];
  const levels = new Map<string, VisibleLevel>();
  for (const repo of store.officeRepos()) {
    if (!visible.has(repo.id)) continue;
    const key = repo.owner.toLowerCase();
    const level = levels.get(key) ?? { owner: repo.owner, key, repoIds: [] };
    level.repoIds.push(repo.id);
    levels.set(key, level);
  }
  return [...levels.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** What Settings shows the person about their own link. Never a token. */
export function linkStatus(
  store: AccessStore,
  userId: string,
  reason: GitHubLinkStatus["unavailableReason"],
): GitHubLinkStatus {
  const link = store.link(userId);
  const visible = store.permissions(userId);
  const repos = store
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
    organizations: store.memberships(userId).map((m) => m.login),
    repos,
  };
}
