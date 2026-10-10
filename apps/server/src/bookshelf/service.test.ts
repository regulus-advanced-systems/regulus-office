/**
 * The bookshelf service (#264): who may read a room's docs, where they are
 * read from, and what a hostile repo or a hostile request cannot do.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOOKSHELF_LIMITS } from "@regulus/protocol";
import { seedRepoPermission, seedRoomAccess } from "../github/access/test-snapshot.ts";
import { REFRESH_AFTER_MS } from "./service.ts";
import {
  BRANCH,
  git,
  OUTSIDE_SECRET,
  type ShelfOffice,
  startShelfOffice,
  TEST_REFRESH_WAIT_MS,
} from "./test-helpers.ts";

let office: ShelfOffice;
let reader: { id: string; role: "member" };
let outsider: { id: string; role: "member" };
let owner: { id: string; role: "owner" };

beforeAll(() => {
  office = startShelfOffice();
  reader = office.person("Rita", "member", "read") as typeof reader;
  outsider = office.person("Otto", "member") as typeof outsider;
  // The office owner has linked GitHub, but that account cannot see the repo (D27).
  owner = office.person("Olga", "owner") as typeof owner;
});
afterAll(() => office.stop());

const value = <T>(answer: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!answer.ok) throw new Error(`refused: ${answer.error}`);
  return answer.value;
};
const error = (answer: { ok: boolean; error?: string }) => (answer.ok ? "ok" : answer.error);

describe("the shelf", () => {
  test("lists the repo's Markdown files, README first, and nothing else", async () => {
    const shelf = value(await office.bookshelf.listing(reader, "alpha"));
    expect(shelf).toMatchObject({ state: "ready", repo: "octo/hello", branch: BRANCH });
    expect(shelf.commit).toMatch(/^[0-9a-f]{10}$/);
    expect(shelf.docs.map((d) => d.path)).toEqual([
      "README.md",
      "CONTRIBUTING.markdown",
      "docs/adr/0001-first.md",
      "docs/big.md",
      "docs/binary.md",
      "docs/guide.md",
      'docs/we ird "name" ž.md',
      "src/notes.md",
    ]);
    expect(shelf.total).toBe(8);
    expect(shelf.docs.find((d) => d.path === "docs/big.md")?.tooLarge).toBe(true);
    // Not listed: symlinks, files only in the checkout, vendored trees, other file types.
    const text = JSON.stringify(shelf);
    for (const hidden of ["escape", "absolute", "passwd", "alias", "untracked", "node_modules"])
      expect(text).not.toContain(hidden);
  });

  test("a document comes back as the file's text at the listed commit", async () => {
    const doc = value(await office.bookshelf.document(reader, "alpha", "docs/guide.md"));
    expect(doc.markdown).toContain("# Guide");
    expect(doc.path).toBe("docs/guide.md");
    const odd = value(await office.bookshelf.document(reader, "alpha", 'docs/we ird "name" ž.md'));
    expect(odd.markdown).toBe("# Odd name\n");
  });

  test("it reads what the office fetched for the default branch, not the mirror's checkout", async () => {
    writeFileSync(join(office.upstream, "docs", "later.md"), "# Added later\n");
    git(office.upstream, "add", "-A");
    git(office.upstream, "commit", "--quiet", "-m", "later");
    // Still the old commit: nothing has been fetched.
    let shelf = value(await office.bookshelf.listing(reader, "alpha"));
    expect(shelf.docs.map((d) => d.path)).not.toContain("docs/later.md");
    // A fetch moves origin/<branch>; the mirror's own branch and work tree stay behind.
    git(office.mirror, "fetch", "--quiet", "origin");
    expect(await Bun.file(join(office.mirror, "docs", "later.md")).exists()).toBe(false);
    shelf = value(await office.bookshelf.listing(reader, "alpha"));
    expect(shelf.docs.map((d) => d.path)).toContain("docs/later.md");
    const doc = value(await office.bookshelf.document(reader, "alpha", "docs/later.md"));
    expect(doc.markdown).toBe("# Added later\n");
  });

  test("opening the shelf asks the office to fetch the mirror, at most once per interval", async () => {
    office.advance(REFRESH_AFTER_MS + 1);
    office.refreshed.length = 0;
    const first = value(await office.bookshelf.listing(reader, "alpha"));
    value(await office.bookshelf.listing(reader, "alpha"));
    value(await office.bookshelf.document(reader, "alpha", "README.md"));
    expect(office.refreshed).toEqual(["repo-alpha"]);
    expect(first.fetchedAt).toBeGreaterThan(0);
    office.advance(REFRESH_AFTER_MS + 1);
    value(await office.bookshelf.listing(reader, "alpha"));
    expect(office.refreshed).toEqual(["repo-alpha", "repo-alpha"]);
    // Someone without access never makes the office fetch anything.
    office.advance(REFRESH_AFTER_MS + 1);
    await office.bookshelf.listing(outsider, "alpha");
    expect(office.refreshed).toHaveLength(2);
  });

  test("the shelf shows what a due fetch brought in; a fetch that fails or hangs costs only freshness", async () => {
    writeFileSync(join(office.upstream, "docs", "fresh.md"), "# Fresh\n");
    git(office.upstream, "add", "-A");
    git(office.upstream, "commit", "--quiet", "-m", "fresh");
    office.advance(REFRESH_AFTER_MS + 1);
    office.fetching.run = async () => {
      git(office.mirror, "fetch", "--quiet", "origin");
    };
    const fresh = value(await office.bookshelf.listing(reader, "alpha"));
    expect(fresh.docs.map((d) => d.path)).toContain("docs/fresh.md");

    office.advance(REFRESH_AFTER_MS + 1);
    office.fetching.run = async () => {
      throw new Error("remote: Repository not found");
    };
    expect(value(await office.bookshelf.listing(reader, "alpha")).docs.length).toBe(
      fresh.docs.length,
    );

    office.advance(REFRESH_AFTER_MS + 1);
    office.fetching.run = () => new Promise<void>(() => undefined);
    const started = performance.now();
    expect(value(await office.bookshelf.listing(reader, "alpha")).state).toBe("ready");
    const waited = performance.now() - started;
    expect(waited).toBeGreaterThanOrEqual(TEST_REFRESH_WAIT_MS - 20);
    expect(waited).toBeLessThan(2000);
    // While that fetch hangs, nobody else waits for it.
    const again = performance.now();
    value(await office.bookshelf.listing(reader, "alpha"));
    expect(performance.now() - again).toBeLessThan(1000);
    office.fetching.run = async () => undefined;
  });

  test("a room without a repo, or whose mirror is not ready, has an empty shelf", async () => {
    office.addRoom("cloning", { cloneStatus: "cloning", workdir: "/nonexistent/264/a" });
    office.addRoom("broken", { workdir: "/nonexistent/264/b" });
    office.addRoom("badbranch", { defaultBranch: "--upload-pack=touch /tmp/x" });
    for (const id of ["cloning", "broken", "badbranch"])
      seedRoomAccess(office.db, reader.id, id, "read");
    expect(value(await office.bookshelf.listing(reader, "cloning"))).toMatchObject({
      state: "cloning",
      docs: [],
    });
    for (const id of ["broken", "badbranch"]) {
      expect(value(await office.bookshelf.listing(reader, id)).state).toBe("unavailable");
      expect(error(await office.bookshelf.document(reader, id, "README.md"))).toBe("unavailable");
    }
  });
});

describe("paths cannot leave the repo's tree", () => {
  test.each([
    "../secret.md",
    "../../secret.md",
    "docs/../../secret.md",
    "docs/../../../secret.md",
    "/etc/passwd",
    "//etc/passwd",
    "docs/./guide.md",
    "docs//guide.md",
    "docs\\guide.md",
    "..\\..\\secret.md",
    "README.md\u0000.png",
    "docs/guide.md\n",
    ".git/config",
    "docs/.git/HEAD",
    "",
    "x".repeat(BOOKSHELF_LIMITS.pathMax + 1),
  ])("%j is not a path", async (path) => {
    expect(error(await office.bookshelf.document(reader, "alpha", path))).toBe("bad_path");
    expect(error(await office.bookshelf.image(reader, "alpha", path))).toBe("bad_path");
  });

  test("a missing path parameter, or one that is not a string, is not a path", async () => {
    for (const path of [null, undefined, 7, ["README.md"], { path: "README.md" }])
      expect(error(await office.bookshelf.document(reader, "alpha", path))).toBe("bad_path");
  });

  test.each([
    // Symlinks committed to the repo: not on the shelf, never followed.
    "docs/escape.md",
    "absolute.md",
    "passwd.md",
    "docs/alias.md",
    // Well-formed, but not in the commit's tree or not a document.
    "untracked.md",
    "secret.md",
    "docs/page.html",
    "docs/img/ok.png",
    "node_modules/pkg/README.md",
    "HEAD",
    "docs",
    ":/README.md",
    ":(top)README.md",
    "trunk:README.md",
    "--help",
    "-p",
    "README.md ",
    "readme.md",
  ])("%j is not on the shelf", async (path) => {
    expect(error(await office.bookshelf.document(reader, "alpha", path))).toBe("not_found");
  });

  test("no answer ever carries what lies outside the tree", async () => {
    const shelf = await office.bookshelf.listing(reader, "alpha");
    expect(JSON.stringify(shelf)).not.toContain(OUTSIDE_SECRET);
    // The secret's text, the symlinks' own target text, and a line of /etc/passwd.
    for (const q of [OUTSIDE_SECRET, "secret.md", "root:"]) {
      const found = await office.bookshelf.search(reader, "alpha", q);
      expect(value(found)).toEqual({ hits: [], truncated: false });
    }
  });

  test("files too big, or not text, are refused whole", async () => {
    expect(error(await office.bookshelf.document(reader, "alpha", "docs/big.md"))).toBe(
      "too_large",
    );
    expect(error(await office.bookshelf.document(reader, "alpha", "docs/binary.md"))).toBe(
      "not_text",
    );
  });
});

describe("pictures", () => {
  test("a picture in the tree is served by what its bytes are", async () => {
    const image = value(await office.bookshelf.image(reader, "alpha", "docs/img/ok.png"));
    expect(image.kind).toBe("png");
    expect(image.bytes.subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
    expect(image.oid).toMatch(/^[0-9a-f]{40}$/);
  });

  test("HTML named .png, SVG, symlinks and documents are not pictures", async () => {
    expect(error(await office.bookshelf.image(reader, "alpha", "docs/img/fake.png"))).toBe(
      "not_image",
    );
    for (const path of ["docs/img/drawing.svg", "docs/img/escape.png", "README.md", "passwd.md"])
      expect(error(await office.bookshelf.image(reader, "alpha", path))).toBe("not_found");
  });
});

describe("search", () => {
  test("finds lines in the shelf's documents only, as plain text", async () => {
    const found = value(await office.bookshelf.search(reader, "alpha", "NEEDLE-one"));
    expect(found.hits.map((h) => `${h.path}:${h.line}`).sort()).toEqual([
      "README.md:3",
      "docs/guide.md:5",
    ]);
    // Regular expression characters are text.
    expect(value(await office.bookshelf.search(reader, "alpha", "a.b*c")).hits).toHaveLength(1);
    expect(value(await office.bookshelf.search(reader, "alpha", "a.b.c")).hits).toHaveLength(0);
    expect(value(await office.bookshelf.search(reader, "alpha", ".*")).hits).toHaveLength(0);
  });

  test("a query that looks like an option or a pathspec is searched for, not obeyed", async () => {
    const marker = join(office.dir, "pwned");
    for (const q of [
      `--open-files-in-pager=touch ${marker}`,
      `-O touch ${marker}`,
      "--no-index",
      "-f/etc/passwd",
      "-- /etc/passwd",
      "$(touch /tmp/x)",
      "`id`",
      "; id",
    ]) {
      const found = await office.bookshelf.search(reader, "alpha", q);
      expect(value(found)).toEqual({ hits: [], truncated: false });
    }
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("too short, too long or malformed queries are refused", async () => {
    for (const q of [
      "",
      " a ",
      "x".repeat(BOOKSHELF_LIMITS.queryMax + 1),
      "a\u0000b",
      "a\nb",
      null,
    ])
      expect(error(await office.bookshelf.search(reader, "alpha", q))).toBe("bad_query");
  });
});

describe("access: a room's docs are its repo's contents", () => {
  const everything = (who: { id: string; role: "member" | "owner" }, room: string) =>
    Promise.all([
      office.bookshelf.listing(who, room),
      office.bookshelf.document(who, room, "README.md"),
      office.bookshelf.document(who, room, "../secret.md"),
      office.bookshelf.document(who, room, null),
      office.bookshelf.image(who, room, "docs/img/ok.png"),
      office.bookshelf.image(who, room, "docs/img/fake.png"),
      office.bookshelf.search(who, room, "needle-one"),
      office.bookshelf.search(who, room, ""),
    ]);

  test("someone whose GitHub does not open the room gets not_found for everything", async () => {
    for (const who of [outsider, owner]) {
      const closed = await everything(who, "alpha");
      const missing = await everything(who, "no-such-room");
      expect(closed).toEqual(missing);
      for (const answer of closed) expect(answer).toEqual({ ok: false, error: "not_found" });
    }
  });

  test("read access is enough; a room that does not exist is not_found for a reader too", async () => {
    expect((await everything(reader, "alpha")).map(error)).toEqual([
      "ok",
      "ok",
      "bad_path",
      "bad_path",
      "ok",
      "not_image",
      "ok",
      "bad_query",
    ]);
    for (const answer of await everything(reader, "no-such-room"))
      expect(answer).toEqual({ ok: false, error: "not_found" });
  });

  test("access is asked on every request: a person who loses the repo loses the shelf at once", async () => {
    const leaver = office.person("Lena", "member", "write");
    expect((await office.bookshelf.listing(leaver, "alpha")).ok).toBe(true);
    expect((await office.bookshelf.document(leaver, "alpha", "README.md")).ok).toBe(true);
    seedRepoPermission(office.db, leaver.id, "repo-alpha", "none");
    for (const answer of await everything(leaver as never, "alpha"))
      expect(answer).toEqual({ ok: false, error: "not_found" });
  });
});
