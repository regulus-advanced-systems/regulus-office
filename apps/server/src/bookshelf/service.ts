/**
 * The room's bookshelf (#264): the Markdown files of the room's repo, read
 * from the office's own mirror at the default branch (git-tree.ts).
 *
 * Access. A room's docs are its repo's contents. Every method takes the
 * person asking and goes through the office's one gate
 * (`operationAccessFor`, D27, D34) before it looks at anything; without
 * access the answer is `not_found`, the same as for a room that does not
 * exist. Nothing is cached per person, and nothing about a shelf is ever
 * put into live room state.
 *
 * Reading. The tree of the branch's commit is listed once and kept until
 * the branch moves. A request's path is checked for form
 * (`bookshelfPath`) and then only looked up in that listing; the file is
 * read by the object id the listing holds. Symlinks and submodules are not
 * in the listing, so they can be neither opened nor followed.
 *
 * Freshness. The mirror is the office's (SPEC §8): when a shelf is opened
 * and the mirror was last fetched more than {@link REFRESH_AFTER_MS} ago,
 * the office fetches it in the background with its own repo credential,
 * never a person's token; the answer does not wait for that.
 */
import {
  BOOKSHELF_LIMITS,
  type BookshelfDoc,
  type BookshelfDocument,
  type BookshelfError,
  type BookshelfListing,
  type BookshelfSearchResponse,
  bookshelfPath,
  isBookshelfDocPath,
  isBookshelfImagePath,
} from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import type { RepoAccess, RepoCheckout } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import { type OperationActor, operationAccessFor } from "../operations/access.ts";
import {
  type GitReader,
  grepTree,
  listTree,
  readBlob,
  readGit,
  resolveCommit,
  type TreeEntry,
} from "./git-tree.ts";
import { type DocImageKind, sniffDocImage } from "./image.ts";

export const REFRESH_AFTER_MS = 5 * 60_000;
/** Search output read from git before the search is called truncated. */
const SEARCH_MAX_BYTES = 512 * 1024;

export type Refused = { ok: false; error: BookshelfError };
export type Answer<T> = { ok: true; value: T } | Refused;

const refuse = (error: BookshelfError): Refused => ({ ok: false, error });

interface Shelf {
  mirror: string;
  commit: string;
  docs: Map<string, TreeEntry>;
  /** In shelf order, at most `maxDocs`. */
  listed: BookshelfDoc[];
  total: number;
  images: Map<string, TreeEntry>;
}

export interface BookshelfDeps {
  db: Db;
  repos: Pick<RepoAccess, "listOperationRepos">;
  logger: Logger;
  git?: GitReader;
  /** Fetch the repo's mirror with the office's own credential (never a person's). */
  refresh?(repo: RepoCheckout): Promise<void>;
  now?(): number;
}

/** README first, then the repo root, then `docs/`, then the rest; by path within each. */
function shelfRank(path: string): number {
  const depth = path.split("/").length - 1;
  if (depth === 0) return /^readme\./i.test(path) ? 0 : 1;
  return /^docs?\//i.test(path) ? 2 : 3;
}

function buildShelf(mirror: string, commit: string, entries: readonly TreeEntry[]): Shelf {
  const docs: TreeEntry[] = [];
  const images = new Map<string, TreeEntry>();
  for (const entry of entries) {
    if (!bookshelfPath(entry.path)) continue;
    // Vendored trees are not the repo's own documentation.
    if (entry.path.split("/").includes("node_modules")) continue;
    if (isBookshelfDocPath(entry.path)) docs.push(entry);
    else if (isBookshelfImagePath(entry.path) && images.size < BOOKSHELF_LIMITS.maxImages)
      images.set(entry.path, entry);
  }
  docs.sort(
    (a, b) =>
      shelfRank(a.path) - shelfRank(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  const kept = docs.slice(0, BOOKSHELF_LIMITS.maxDocs);
  return {
    mirror,
    commit,
    docs: new Map(kept.map((d) => [d.path, d])),
    listed: kept.map((d) => ({
      path: d.path,
      size: d.size,
      tooLarge: d.size > BOOKSHELF_LIMITS.docMaxBytes,
    })),
    total: docs.length,
    images,
  };
}

export class Bookshelf {
  readonly #deps: BookshelfDeps;
  readonly #git: GitReader;
  readonly #now: () => number;
  readonly #shelves = new Map<string, Shelf>();
  readonly #building = new Map<string, Promise<Shelf | null>>();
  readonly #fetched = new Map<string, number>();
  readonly #fetching = new Set<string>();

  constructor(deps: BookshelfDeps) {
    this.#deps = deps;
    this.#git = deps.git ?? readGit;
    this.#now = deps.now ?? Date.now;
  }

  /** The room's one repo (D7), if the person asking may see the room. */
  #repoFor(actor: OperationActor, operationId: string): RepoCheckout | null | Refused {
    if (!operationAccessFor(this.#deps.db, actor, operationId)) return refuse("not_found");
    const repos = this.#deps.repos.listOperationRepos(operationId);
    return repos.find((r) => r.isPrimary) ?? repos[0] ?? null;
  }

  async #shelf(repo: RepoCheckout): Promise<Shelf | null> {
    if (repo.cloneStatus !== "ready") return null;
    const commit = await resolveCommit(this.#git, repo.workdir, repo.defaultBranch);
    if (!commit) return null;
    const have = this.#shelves.get(repo.repoId);
    if (have && have.commit === commit && have.mirror === repo.workdir) return have;
    const key = `${repo.repoId}\0${repo.workdir}\0${commit}`;
    let building = this.#building.get(key);
    if (!building) {
      building = listTree(this.#git, repo.workdir, commit)
        .then((tree) => {
          if (!tree) return null;
          const shelf = buildShelf(repo.workdir, commit, tree.entries);
          this.#shelves.set(repo.repoId, shelf);
          return shelf;
        })
        .finally(() => this.#building.delete(key));
      this.#building.set(key, building);
    }
    return building;
  }

  #refreshInBackground(repo: RepoCheckout): void {
    const { refresh, logger } = this.#deps;
    if (!refresh || repo.cloneStatus !== "ready" || this.#fetching.has(repo.repoId)) return;
    const last = this.#fetched.get(repo.repoId);
    if (last !== undefined && this.#now() - last < REFRESH_AFTER_MS) return;
    this.#fetching.add(repo.repoId);
    // Marked before the fetch ends, so a failing remote is not asked on every open.
    this.#fetched.set(repo.repoId, this.#now());
    void refresh(repo)
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ repoId: repo.repoId, reason: reason.slice(0, 300) }, "shelf fetch failed");
      })
      .finally(() => this.#fetching.delete(repo.repoId));
  }

  async listing(actor: OperationActor, operationId: string): Promise<Answer<BookshelfListing>> {
    const repo = this.#repoFor(actor, operationId);
    if (repo && "ok" in repo) return repo;
    const empty = (state: BookshelfListing["state"]): Answer<BookshelfListing> => ({
      ok: true,
      value: {
        state,
        repo: repo ? `${repo.owner}/${repo.name}` : "",
        branch: repo?.defaultBranch ?? "",
        commit: "",
        docs: [],
        total: 0,
        fetchedAt: null,
      },
    });
    if (!repo) return empty("no_repo");
    if (repo.cloneStatus === "cloning") return empty("cloning");
    const shelf = await this.#shelf(repo);
    if (!shelf) return empty("unavailable");
    this.#refreshInBackground(repo);
    return {
      ok: true,
      value: {
        state: "ready",
        repo: `${repo.owner}/${repo.name}`,
        branch: repo.defaultBranch,
        commit: shelf.commit.slice(0, 10),
        docs: shelf.listed,
        total: shelf.total,
        fetchedAt: this.#fetched.get(repo.repoId) ?? null,
      },
    };
  }

  /** The shelf and the listed entry a request's path names, after the gate. */
  async #entry(
    actor: OperationActor,
    operationId: string,
    rawPath: unknown,
    kind: "docs" | "images",
  ): Promise<Answer<{ shelf: Shelf; entry: TreeEntry }>> {
    const repo = this.#repoFor(actor, operationId);
    if (repo && "ok" in repo) return repo;
    const path = bookshelfPath(rawPath);
    if (!path) return refuse("bad_path");
    const shelf = repo ? await this.#shelf(repo) : null;
    if (!shelf) return refuse("unavailable");
    const entry = shelf[kind].get(path);
    return entry ? { ok: true, value: { shelf, entry } } : refuse("not_found");
  }

  async document(
    actor: OperationActor,
    operationId: string,
    rawPath: unknown,
  ): Promise<Answer<BookshelfDocument>> {
    const found = await this.#entry(actor, operationId, rawPath, "docs");
    if (!found.ok) return found;
    const { shelf, entry } = found.value;
    if (entry.size > BOOKSHELF_LIMITS.docMaxBytes) return refuse("too_large");
    const bytes = await readBlob(this.#git, shelf.mirror, entry.oid, BOOKSHELF_LIMITS.docMaxBytes);
    if (!bytes) return refuse("unavailable");
    // A binary file with a Markdown name is not a document.
    if (bytes.includes(0)) return refuse("not_text");
    return {
      ok: true,
      value: {
        path: entry.path,
        commit: shelf.commit.slice(0, 10),
        size: entry.size,
        markdown: new TextDecoder().decode(bytes),
      },
    };
  }

  async image(
    actor: OperationActor,
    operationId: string,
    rawPath: unknown,
  ): Promise<Answer<{ bytes: Uint8Array; kind: DocImageKind; oid: string }>> {
    const found = await this.#entry(actor, operationId, rawPath, "images");
    if (!found.ok) return found;
    const { shelf, entry } = found.value;
    if (entry.size > BOOKSHELF_LIMITS.imageMaxBytes) return refuse("too_large");
    const bytes = await readBlob(
      this.#git,
      shelf.mirror,
      entry.oid,
      BOOKSHELF_LIMITS.imageMaxBytes,
    );
    if (!bytes) return refuse("unavailable");
    // By its own bytes, never by its name: an HTML or SVG file called a.png is refused.
    const kind = sniffDocImage(bytes);
    return kind ? { ok: true, value: { bytes, kind, oid: entry.oid } } : refuse("not_image");
  }

  async search(
    actor: OperationActor,
    operationId: string,
    rawQuery: unknown,
  ): Promise<Answer<BookshelfSearchResponse>> {
    const repo = this.#repoFor(actor, operationId);
    if (repo && "ok" in repo) return repo;
    const q = typeof rawQuery === "string" ? rawQuery.trim() : "";
    const malformed = /[\u0000-\u001f\u007f]/.test(q);
    if (q.length < BOOKSHELF_LIMITS.queryMin || q.length > BOOKSHELF_LIMITS.queryMax || malformed)
      return refuse("bad_query");
    const shelf = repo ? await this.#shelf(repo) : null;
    if (!shelf) return refuse("unavailable");
    const found = await grepTree(this.#git, shelf.mirror, shelf.commit, q, SEARCH_MAX_BYTES);
    if (!found) return refuse("unavailable");
    // Only what is on the shelf: a symlink or an unlisted file never shows a line.
    const lines = found.lines.filter((l) => shelf.docs.has(l.path));
    return {
      ok: true,
      value: {
        hits: lines.slice(0, BOOKSHELF_LIMITS.maxHits).map((l) => ({
          path: l.path,
          line: l.line,
          text: l.text.trim().slice(0, BOOKSHELF_LIMITS.hitTextMax),
        })),
        truncated: found.overflow || lines.length > BOOKSHELF_LIMITS.maxHits,
      },
    };
  }
}
