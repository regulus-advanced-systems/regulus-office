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
 * the office fetches it with its own repo credential, never a person's
 * token. The listing waits for that fetch at most {@link REFRESH_WAIT_MS}
 * and then answers with what the mirror holds; a fetch that fails or is
 * slow costs freshness, never the shelf.
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
  type GitStream,
  grepTree,
  listTree,
  readBlob,
  readGit,
  resolveCommit,
  streamGit,
  type TreeEntry,
} from "./git-tree.ts";
import { type DocImageKind, sniffDocImage } from "./image.ts";

export const REFRESH_AFTER_MS = 5 * 60_000;
/** How long opening a shelf waits for a due fetch before answering without it. */
export const REFRESH_WAIT_MS = 2500;
/** Searches the office runs at once; a person runs one. */
export const SEARCHES_AT_ONCE = 4;

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
  /** Paths a search reads: the listed documents the reader would open. */
  searched: string[];
}

export interface BookshelfDeps {
  db: Db;
  repos: Pick<RepoAccess, "listOperationRepos">;
  logger: Logger;
  git?: GitReader;
  /** Git for searches: read as it arrives, stopped early (tests slow it down). */
  stream?: GitStream;
  /** Fetch the repo's mirror with the office's own credential (never a person's). */
  refresh?(repo: RepoCheckout): Promise<void>;
  now?(): number;
  /** How long a listing waits for a due fetch (default {@link REFRESH_WAIT_MS}). */
  refreshWaitMs?: number;
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
    searched: kept.filter((d) => d.size <= BOOKSHELF_LIMITS.docMaxBytes).map((d) => d.path),
  };
}

export class Bookshelf {
  readonly #deps: BookshelfDeps;
  readonly #git: GitReader;
  readonly #now: () => number;
  readonly #shelves = new Map<string, Shelf>();
  readonly #building = new Map<string, Promise<Shelf | null>>();
  /** When each repo's mirror was last fetched with success, and when a fetch was last tried. */
  readonly #fetched = new Map<string, number>();
  readonly #attempted = new Map<string, number>();
  readonly #fetching = new Set<string>();
  /** People with a search running. */
  readonly #searching = new Set<string>();
  readonly #stream: GitStream;

  constructor(deps: BookshelfDeps) {
    this.#deps = deps;
    this.#git = deps.git ?? readGit;
    this.#stream = deps.stream ?? streamGit;
    this.#now = deps.now ?? Date.now;
  }

  /** The room's one repo (D7), if the person asking may see the room. */
  #repoFor(actor: OperationActor, operationId: string): RepoCheckout | null | Refused {
    if (!operationAccessFor(this.#deps.db, actor, operationId)) return refuse("not_found");
    const repos = this.#deps.repos.listOperationRepos(operationId);
    return repos.find((r) => r.isPrimary) ?? repos[0] ?? null;
  }

  /**
   * The shelf at the commit the office last fetched for the default branch;
   * `no_branch` when the mirror has no such remote branch (renamed upstream,
   * say); null when the mirror cannot be read.
   */
  async #shelf(repo: RepoCheckout): Promise<Shelf | "no_branch" | null> {
    if (repo.cloneStatus !== "ready") return null;
    const commit = await resolveCommit(this.#git, repo.workdir, repo.defaultBranch);
    if (commit === "missing") return "no_branch";
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

  /**
   * Fetch the mirror when it is due. Resolves when the fetch ends or after
   * {@link REFRESH_WAIT_MS}, whichever is first (the fetch carries on); at
   * once when no fetch is due or one is already running.
   */
  #refresh(repo: RepoCheckout): Promise<void> {
    const { refresh, logger } = this.#deps;
    if (!refresh || this.#fetching.has(repo.repoId)) return Promise.resolve();
    const last = this.#attempted.get(repo.repoId);
    if (last !== undefined && this.#now() - last < REFRESH_AFTER_MS) return Promise.resolve();
    this.#fetching.add(repo.repoId);
    // The limit is on attempts, so a failing remote is not asked on every open;
    // `fetchedAt` is only ever the time of a fetch that worked.
    this.#attempted.set(repo.repoId, this.#now());

    const fetched = refresh(repo)
      .then(
        () => {
          this.#fetched.set(repo.repoId, this.#now());
        },
        (err) => {
          const reason = err instanceof Error ? err.message : String(err);
          logger.warn({ repoId: repo.repoId, reason: reason.slice(0, 300) }, "shelf fetch failed");
        },
      )
      .finally(() => this.#fetching.delete(repo.repoId));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.#deps.refreshWaitMs ?? REFRESH_WAIT_MS);
    });
    return Promise.race([fetched, patience]).finally(() => clearTimeout(timer));
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
    if (repo.cloneStatus === "ready") await this.#refresh(repo);
    const shelf = await this.#shelf(repo);
    if (shelf === "no_branch") return empty("no_branch");
    if (!shelf) return empty("unavailable");
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
    if (!shelf || shelf === "no_branch") return refuse("unavailable");

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

  /**
   * Lines of the shelf's documents that contain the text. One search at a
   * time for a person and {@link SEARCHES_AT_ONCE} for the office: the rest
   * are told `busy` and ask again. `signal` (the request was dropped) stops
   * git.
   */
  async search(
    actor: OperationActor,
    operationId: string,
    rawQuery: unknown,
    signal?: AbortSignal,
  ): Promise<Answer<BookshelfSearchResponse>> {
    const repo = this.#repoFor(actor, operationId);
    if (repo && "ok" in repo) return repo;
    const q = typeof rawQuery === "string" ? rawQuery.trim() : "";
    const malformed = /[\u0000-\u001f\u007f]/.test(q);
    if (q.length < BOOKSHELF_LIMITS.queryMin || q.length > BOOKSHELF_LIMITS.queryMax || malformed)
      return refuse("bad_query");
    if (this.#searching.has(actor.id) || this.#searching.size >= SEARCHES_AT_ONCE)
      return refuse("busy");
    this.#searching.add(actor.id);
    try {
      const shelf = repo ? await this.#shelf(repo) : null;
      if (!shelf || shelf === "no_branch") return refuse("unavailable");
      // Only the shelf's own documents are read, each of a size the reader would open:
      // the paths come from the office's listing, and a symlink or an unlisted file is not one.
      const found = await grepTree(this.#stream, shelf.mirror, shelf.commit, q, shelf.searched, {
        maxLines: BOOKSHELF_LIMITS.maxHits,
        // Room for the excerpt in any encoding; the rest of a long line is not kept.
        lineBytes: BOOKSHELF_LIMITS.hitTextMax * 4,
        signal,
      });
      if (!found) return refuse("unavailable");
      return {
        ok: true,
        value: {
          hits: found.lines
            .filter((l) => shelf.docs.has(l.path))
            .map((l) => ({
              path: l.path,
              line: l.line,
              text: l.text.trim().slice(0, BOOKSHELF_LIMITS.hitTextMax),
            })),
          truncated: found.more,
        },
      };
    } finally {
      this.#searching.delete(actor.id);
    }
  }
}
