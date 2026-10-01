/**
 * Repos an office GitHub connection can see (#141), for the "Add operation"
 * picker and for deciding whether an operation repo is covered by the connection.
 *
 * - App: `GET /installation/repositories` with an installation token.
 * - Org PAT: `GET /user/repos`, which for a fine-grained token lists the
 *   repos the token was granted.
 * Both are paged 100 at a time and capped at {@link MAX_LISTED_REPOS}.
 * https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation
 * https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user
 */
import type { GitHubRepoInfo } from "@regulus/protocol";
import type { GitHubCaller } from "./api.ts";

export const MAX_LISTED_REPOS = 2000;
const PER_PAGE = 100;

interface RawRepo {
  name?: unknown;
  full_name?: unknown;
  owner?: { login?: unknown } | null;
  private?: unknown;
  default_branch?: unknown;
  pushed_at?: unknown;
  description?: unknown;
}

export function toRepoInfo(raw: RawRepo): GitHubRepoInfo | null {
  const owner = raw.owner?.login;
  if (typeof owner !== "string" || typeof raw.name !== "string") return null;
  const pushed = typeof raw.pushed_at === "string" ? Date.parse(raw.pushed_at) : Number.NaN;
  const description = typeof raw.description === "string" ? raw.description.slice(0, 500) : null;
  return {
    owner,
    name: raw.name,
    fullName: `${owner}/${raw.name}`,
    private: raw.private === true,
    defaultBranch: typeof raw.default_branch === "string" ? raw.default_branch : "main",
    pushedAt: Number.isFinite(pushed) ? pushed : null,
    description,
  };
}

export interface RepoList {
  repos: GitHubRepoInfo[];
  truncated: boolean;
}

async function paged(
  fetchPage: (page: number) => Promise<RawRepo[]>,
  limit: number,
): Promise<RepoList> {
  const repos: GitHubRepoInfo[] = [];
  for (let page = 1; ; page += 1) {
    const list = await fetchPage(page);
    for (const raw of list) {
      const info = toRepoInfo(raw);
      if (!info) continue;
      if (repos.length >= limit) return { repos, truncated: true };
      repos.push(info);
    }
    if (list.length < PER_PAGE) return { repos, truncated: false };
  }
}

export function listInstallationRepos(
  api: GitHubCaller,
  token: string,
  limit = MAX_LISTED_REPOS,
): Promise<RepoList> {
  return paged(async (page) => {
    const body = await api.json<{ repositories?: RawRepo[] }>({
      path: `/installation/repositories?per_page=${PER_PAGE}&page=${page}`,
      bearer: token,
    });
    return Array.isArray(body.repositories) ? body.repositories : [];
  }, limit);
}

export function listTokenRepos(
  api: GitHubCaller,
  token: string,
  limit = MAX_LISTED_REPOS,
): Promise<RepoList> {
  return paged(async (page) => {
    const body = await api.json<RawRepo[]>({
      path: `/user/repos?per_page=${PER_PAGE}&page=${page}&sort=full_name`,
      bearer: token,
    });
    return Array.isArray(body) ? body : [];
  }, limit);
}

/** Sort for the picker: owner, then name, case-insensitive. */
export function sortRepos(repos: GitHubRepoInfo[]): GitHubRepoInfo[] {
  return [...repos].sort((a, b) =>
    a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase()),
  );
}
