/**
 * Each part's pull request names the others (#257): a marked section at the
 * end of the PR description, rewritten whenever a part gets its pull request.
 *
 * A pull request's description is read by everyone who can read its repo on
 * GitHub, so naming another repo there shows that repo's name to all of them.
 * Rules:
 * - a **public** repo may be named anywhere;
 * - a **private** repo (GitHub reports organisation-internal repos as private
 *   too, and a repo whose visibility the office could not read counts as
 *   private) is named only when the task's owner turned that on for this task,
 *   and then only in other private repos' pull requests, never in a public one;
 * - the office edits only its own marked section and leaves the rest of the
 *   description as the author wrote it; the section goes when nothing may be
 *   named in it any more.
 *
 * One pull request that cannot be read or edited does not hold up the others.
 * While one cannot be read, the others keep what they already say about it.
 *
 * Calls use the repo's project credential (the office GitHub connection or the
 * repo's own PAT, as the one-click PR does; SPEC §8, D14), held only for the
 * call and never logged.
 */
import { createGitHubCaller, type FetchFn } from "../../github/api.ts";
import { GitHubApiError } from "../../github/pulls.ts";
import type { RepoAccess } from "../../github/repo-access.ts";
import type { Logger } from "../../logging.ts";
import type { LinkedTaskStore } from "./store.ts";

export const SECTION_START = "<!-- regulus-office:linked-task -->";
export const SECTION_END = "<!-- /regulus-office:linked-task -->";

export interface PullPage {
  body: string;
  url: string;
  /** `owner/name` as GitHub names it. */
  repo: string;
  /** False only when GitHub said the repo is public. */
  isPrivate: boolean;
}

/** Reading and editing pull request descriptions. */
export interface PullPages {
  read(repoId: string, number: number): Promise<PullPage | null>;
  writeBody(repoId: string, number: number, body: string): Promise<void>;
}

export interface Sibling {
  repo: string;
  number: number;
  url: string;
}

/** `body` with the linked section listing `siblings` (removed when there are none). */
export function withLinkedSection(body: string, siblings: readonly Sibling[]): string {
  const start = body.indexOf(SECTION_START);
  const end = body.indexOf(SECTION_END);
  const has = start >= 0 && end > start;
  const base = has
    ? `${body.slice(0, start)}${body.slice(end + SECTION_END.length)}`.trimEnd()
    : body.trimEnd();
  if (siblings.length === 0) return has ? base : body;
  const section = [
    SECTION_START,
    "### Linked pull requests",
    "",
    "This is one part of a task across several repos. The other parts:",
    "",
    ...siblings.map((s) => `- ${s.repo}#${s.number}: ${s.url}`),
    SECTION_END,
  ].join("\n");
  return base ? `${base}\n\n${section}` : section;
}

/** Which other parts a pull request in `self`'s repo may name. */
export function namable<T extends { page: PullPage }>(
  self: T,
  others: readonly T[],
  namePrivateRepos: boolean,
): T[] {
  return others.filter(
    (o) => o !== self && (!o.page.isPrivate || (namePrivateRepos && self.page.isPrivate)),
  );
}

const detail = (err: unknown) => (err instanceof GitHubApiError ? err.detail : "unexpected error");

export class PullLinker {
  readonly #chains = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: { store: LinkedTaskStore; pages: PullPages; logger: Logger },
  ) {}

  /** Bring every pull request of the task in line; one run per task at a time. */
  relink(linkedTaskId: string): Promise<void> {
    const previous = this.#chains.get(linkedTaskId) ?? Promise.resolve();
    const run = previous
      .then(() => this.#relink(linkedTaskId))
      .catch((err) => {
        this.deps.logger.warn(
          { linkedTaskId, detail: detail(err) },
          "linking pull requests failed",
        );
      })
      .finally(() => {
        if (this.#chains.get(linkedTaskId) === run) this.#chains.delete(linkedTaskId);
      });
    this.#chains.set(linkedTaskId, run);
    return run;
  }

  async idle(): Promise<void> {
    while (this.#chains.size > 0) await Promise.all(this.#chains.values());
  }

  async #relink(linkedTaskId: string): Promise<void> {
    const { store, pages, logger } = this.deps;
    const linked = store.get(linkedTaskId);
    if (!linked) return;
    const found: { repoId: string; number: number; page: PullPage }[] = [];
    let unread = false;
    for (const task of store.tasksOf(linkedTaskId)) {
      if (!task.repoId || !task.prNumber) continue;
      try {
        const page = await pages.read(task.repoId, task.prNumber);
        if (page) found.push({ repoId: task.repoId, number: task.prNumber, page });
        else unread = true;
      } catch (err) {
        unread = true;
        logger.warn({ taskId: task.id, detail: detail(err) }, "a pull request could not be read");
      }
    }
    for (const self of found) {
      const siblings = namable(self, found, linked.namePrivateRepos).map((o) => ({
        repo: o.page.repo,
        number: o.number,
        url: o.page.url,
      }));
      // One could not be read: add what is known, but take nothing away on that account.
      if (unread && self.page.body.includes(SECTION_START)) {
        const kept = siblings.every((s) => self.page.body.includes(`${s.repo}#${s.number}:`));
        if (kept) continue;
      }
      const next = withLinkedSection(self.page.body, siblings);
      if (next === self.page.body) continue;
      try {
        await pages.writeBody(self.repoId, self.number, next);
      } catch (err) {
        logger.warn({ repoId: self.repoId, detail: detail(err) }, "a pull request was not edited");
      }
    }
  }
}

interface RawPull {
  body?: unknown;
  html_url?: unknown;
  base?: { repo?: { private?: unknown; full_name?: unknown } };
}

const seg = (s: string) => encodeURIComponent(s);

/** Pull request descriptions on GitHub, with each repo's project credential. */
export function githubPullPages(deps: {
  repos: RepoAccess;
  apiBase: string;
  fetch?: FetchFn;
}): PullPages {
  const github = createGitHubCaller({ apiBase: deps.apiBase, fetch: deps.fetch });
  const path = (owner: string, name: string, number: number) =>
    `/repos/${seg(owner)}/${seg(name)}/pulls/${number}`;
  return {
    read: (repoId, number) =>
      deps.repos.withRepoCredential(repoId, async ({ repo, token }) => {
        const raw = await github.json<RawPull>({
          path: path(repo.owner, repo.name, number),
          ...(token ? { bearer: token } : {}),
        });
        if (typeof raw.html_url !== "string") return null;
        const fullName = raw.base?.repo?.full_name;
        return {
          body: typeof raw.body === "string" ? raw.body : "",
          url: raw.html_url,
          repo: typeof fullName === "string" ? fullName : `${repo.owner}/${repo.name}`,
          isPrivate: raw.base?.repo?.private !== false,
        };
      }),
    writeBody: (repoId, number, body) =>
      deps.repos.withRepoCredential(repoId, async ({ repo, token }) => {
        // Without a credential the office cannot edit; the links stay in the office.
        if (!token) return;
        await github.json({
          method: "PATCH",
          path: path(repo.owner, repo.name, number),
          bearer: token,
          body: { body },
        });
      }),
  };
}
