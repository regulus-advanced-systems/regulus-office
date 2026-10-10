/**
 * TEST ONLY: a room whose repo is a real git mirror on disk, made the way
 * the office makes one (`git clone` of a remote), with a hostile tree in
 * it: symlinks out of the repo, a huge file, binaries with Markdown and
 * picture names, awkward file names, and secrets next to the mirror that
 * only a filesystem read could reach.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOKSHELF_LIMITS, type UserRole } from "@regulus/protocol";
import { operationRepos, operations } from "../db/schema/index.ts";
import { seedRoomAccess } from "../github/access/test-snapshot.ts";
import { gitBaseEnv } from "../github/git.ts";
import type { RepoCheckout } from "../github/repo-access.ts";
import { createLogger } from "../logging.ts";
import { testDb } from "../operations/test-helpers.ts";
import { makePng } from "../pictures/test-helpers.ts";
import { type GitStream, streamGit } from "./git-tree.ts";
import { Bookshelf } from "./service.ts";

export const BRANCH = "trunk";
/** A short wait for a due fetch, so the test of a hanging one is quick. */
export const TEST_REFRESH_WAIT_MS = 150;
/** Text that exists only outside the repo's tree. */
export const OUTSIDE_SECRET = "OUTSIDE-SECRET-264";

export function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.name=Test", "-c", "user.email=t@example.com", ...args],
    { cwd, env: gitBaseEnv(), stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${proc.stderr.toString()}`);
  return proc.stdout.toString();
}

function write(root: string, path: string, content: string | Uint8Array): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function startShelfOffice() {
  const dir = mkdtempSync(join(tmpdir(), "regulus-shelf-"));
  const upstream = join(dir, "upstream");
  const mirror = join(dir, "projects", "alpha", "hello");
  mkdirSync(upstream, { recursive: true });
  mkdirSync(join(dir, "projects"), { recursive: true });
  git(upstream, "init", "--quiet", `--initial-branch=${BRANCH}`);

  // Outside the repo: only a filesystem read (or a followed symlink) could show these.
  writeFileSync(join(dir, "secret.md"), `# ${OUTSIDE_SECRET}\n`);
  writeFileSync(join(dir, "projects", "secret.md"), `# ${OUTSIDE_SECRET}\n`);

  write(upstream, "README.md", "# Hello\n\nSee [the guide](docs/guide.md). needle-one\n");
  write(upstream, "CONTRIBUTING.markdown", "# Contributing\n");
  write(upstream, "docs/guide.md", "# Guide\n\n![shot](img/ok.png)\n\nneedle-one and a.b*c\n");
  write(upstream, "docs/adr/0001-first.md", "# ADR 1\n");
  write(upstream, 'docs/we ird "name" ž.md', "# Odd name\n");
  write(upstream, "src/notes.md", "# Notes in src\n");
  write(upstream, "node_modules/pkg/README.md", "# Vendored needle-one\n");
  write(upstream, "docs/img/ok.png", makePng());
  write(upstream, "docs/img/fake.png", "<html><script>alert(1)</script></html>");
  write(
    upstream,
    "docs/img/drawing.svg",
    '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
  );
  write(upstream, "docs/binary.md", new Uint8Array([35, 32, 0, 1, 2, 3]));
  write(upstream, "docs/big.md", `# Big\n${"x".repeat(BOOKSHELF_LIMITS.docMaxBytes)}\n`);
  write(upstream, "docs/page.html", "<script>alert(1)</script>");
  // Symlinks: to a file outside the repo, by relative and absolute target, and to a real doc.
  symlinkSync("../../secret.md", join(upstream, "docs", "escape.md"));
  symlinkSync(join(dir, "secret.md"), join(upstream, "absolute.md"));
  symlinkSync("/etc/passwd", join(upstream, "passwd.md"));
  symlinkSync("guide.md", join(upstream, "docs", "alias.md"));
  symlinkSync("../../secret.md", join(upstream, "docs", "img", "escape.png"));
  git(upstream, "add", "-A");
  git(upstream, "commit", "--quiet", "-m", "docs");

  mkdirSync(join(mirror, ".."), { recursive: true });
  git(dir, "clone", "--quiet", "--", upstream, mirror);
  // In the mirror's checkout but in no commit: a reader of the checkout would list it.
  writeFileSync(join(mirror, "untracked.md"), `# ${OUTSIDE_SECRET}\n`);

  const { db, addUser } = testDb();
  let seq = 0;
  const addRoom = (id: string, repo: Partial<typeof operationRepos.$inferInsert> = {}) => {
    seq += 1;
    db.insert(operations)
      .values({ id, name: id, slug: id, index: seq, paletteId: "p", layoutTemplateId: "t" })
      .run();
    db.insert(operationRepos)
      .values({
        id: `repo-${id}`,
        operationId: id,
        owner: "octo",
        name: "hello",
        url: "https://github.com/octo/hello",
        workdir: mirror,
        defaultBranch: BRANCH,
        isPrimary: true,
        cloneStatus: "ready",
        ...repo,
      })
      .run();
  };
  addRoom("alpha");

  const person = (name: string, role: UserRole, permission?: "read" | "write" | "admin") => {
    const user = addUser(name, role);
    if (permission) seedRoomAccess(db, user.id, "alpha", permission);
    return user;
  };

  const repos = {
    listOperationRepos: (operationId: string): RepoCheckout[] =>
      db
        .select()
        .from(operationRepos)
        .all()
        .filter((r) => r.operationId === operationId)
        .map((r) => ({
          repoId: r.id,
          operationId: r.operationId,
          owner: r.owner,
          name: r.name,
          workdir: r.workdir,
          defaultBranch: r.defaultBranch,
          remoteUrl: r.url,
          cloneStatus: r.cloneStatus,
          isPrimary: r.isPrimary,
        })),
  };
  const refreshed: string[] = [];
  let now = 1_000_000;
  /** What the office's fetch of the mirror does in this test (nothing, by default). */
  const fetching = { run: async (_repo: RepoCheckout): Promise<void> => undefined };
  /** Git for searches in this test (the real one, by default). */
  const searching: { stream?: GitStream } = {};
  const bookshelf = new Bookshelf({
    db,
    repos,
    logger: createLogger({ level: "silent" }),
    refreshWaitMs: TEST_REFRESH_WAIT_MS,
    stream: (...args) => (searching.stream ?? streamGit)(...args),
    refresh: (repo) => {
      refreshed.push(repo.repoId);
      return fetching.run(repo);
    },
    now: () => now,
  });

  return {
    db,
    dir,
    upstream,
    mirror,
    bookshelf,
    refreshed,
    fetching,
    searching,
    addRoom,
    person,
    advance: (ms: number) => {
      now += ms;
    },
    stop() {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type ShelfOffice = ReturnType<typeof startShelfOffice>;
