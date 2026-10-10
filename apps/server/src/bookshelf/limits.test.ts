/**
 * The bookshelf under a hostile or busy repo (#264 review): long lines and
 * search, searches at once and dropped requests, what `fetchedAt` means, a
 * default branch that is gone, and file names made to read as others.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOOKSHELF_LIMITS, bookshelfPath } from "@regulus/protocol";
import { type GitStream, streamGit } from "./git-tree.ts";
import { REFRESH_AFTER_MS, SEARCHES_AT_ONCE } from "./service.ts";
import { BRANCH, git, type ShelfOffice, startShelfOffice } from "./test-helpers.ts";

/** Right-to-left override, zero-width space, an isolate, a soft hyphen, a line separator, NEL. */
const INVISIBLE = [0x202e, 0x200b, 0x2066, 0x00ad, 0x2028, 0x0085].map((c) =>
  String.fromCodePoint(c),
);
const SPOOFED = `docs/harmless${INVISIBLE[0]}dm.exe.md`;

let office: ShelfOffice;
let reader: { id: string; role: "member" };

const value = <T>(answer: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!answer.ok) throw new Error(`refused: ${answer.error}`);
  return answer.value;
};
const error = (answer: { ok: boolean; error?: string }) => (answer.ok ? "ok" : answer.error);

function write(path: string, content: string): void {
  mkdirSync(join(office.upstream, path, ".."), { recursive: true });
  writeFileSync(join(office.upstream, path), content);
}

beforeAll(() => {
  office = startShelfOffice();
  reader = office.person("Rita", "member", "read") as typeof reader;
  // Early in tree order: one line of 400 KB (a document the reader opens), and one of
  // 640 KB (too large to open, so not searched either).
  write(".changes/long.md", `needle-two ${"lorem the ipsum ".repeat(25_000)}\n`);
  write(".changes/longer.md", `needle-two ${"lorem the ipsum ".repeat(40_000)}\n`);
  for (let i = 0; i < 12; i++) write(`many/f${i}.md`, "common-word here\n".repeat(30));
  write(SPOOFED, "# Not what its name says\n\nneedle-two\n");
  write(`docs/zero${INVISIBLE[1]}width.md`, "# needle-two\n");
  git(office.upstream, "add", "-A");
  git(office.upstream, "commit", "--quiet", "-m", "hostile");
  git(office.mirror, "fetch", "--quiet", "origin");
});
afterAll(() => office.stop());

describe("search and long lines", () => {
  test("a very long line early in the tree does not blank the search", async () => {
    const found = value(await office.bookshelf.search(reader, "alpha", "needle-one"));
    expect(found.hits.map((h) => h.path).sort()).toEqual(["README.md", "docs/guide.md"]);
    expect(found.truncated).toBe(false);
    // "the" is on the long lines and in ordinary documents: all of them answer.
    const the = value(await office.bookshelf.search(reader, "alpha", "the"));
    expect(the.hits.map((h) => h.path)).toContain(".changes/long.md");
    expect(the.hits.map((h) => h.path)).toContain("README.md");
    expect(the.truncated).toBe(false);
  });

  test("a hit keeps the start of its line, however long the line is", async () => {
    const found = value(await office.bookshelf.search(reader, "alpha", "needle-two"));
    // The 640 KB file is not searched; the oddly named files are not on the shelf.
    expect(found.hits.map((h) => h.path)).toEqual([".changes/long.md"]);
    expect(found.hits[0]?.text).toHaveLength(BOOKSHELF_LIMITS.hitTextMax);
    expect(found.hits[0]?.text.startsWith("needle-two lorem the ipsum")).toBe(true);
  });

  test("the limit counts hits that are kept, and says when there were more", async () => {
    const found = value(await office.bookshelf.search(reader, "alpha", "common-word"));
    expect(found.hits).toHaveLength(BOOKSHELF_LIMITS.maxHits);
    expect(found.truncated).toBe(true);
    // 20 lines a file at most, so one file cannot crowd out the rest.
    expect(new Set(found.hits.map((h) => h.path)).size).toBeGreaterThanOrEqual(5);
  });
});

describe("searches at once", () => {
  test("one for a person, a few for the office; the rest are told busy and may ask again", async () => {
    const people = Array.from({ length: SEARCHES_AT_ONCE + 1 }, (_, i) =>
      office.person(`P${i}`, "member", "read"),
    );
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    office.searching.stream = async (...args) => {
      started += 1;
      await held;
      return streamGit(...args);
    };
    const running = people
      .slice(0, SEARCHES_AT_ONCE)
      .map((p) => office.bookshelf.search(p, "alpha", "needle-one"));
    await Bun.sleep(50);
    expect(started).toBe(SEARCHES_AT_ONCE);
    // The same person again, and one person more than the office runs at once.
    const first = people[0] as (typeof people)[number];
    const last = people[SEARCHES_AT_ONCE] as (typeof people)[number];
    expect(error(await office.bookshelf.search(first, "alpha", "needle-one"))).toBe("busy");
    expect(error(await office.bookshelf.search(last, "alpha", "needle-one"))).toBe("busy");
    expect(started).toBe(SEARCHES_AT_ONCE);
    // Someone who may not see the room learns nothing from the queue: still not_found.
    const outsider = office.person("Otto", "member");
    expect(error(await office.bookshelf.search(outsider, "alpha", "needle-one"))).toBe("not_found");
    release();
    for (const answer of await Promise.all(running)) expect(value(answer).hits).toHaveLength(2);
    office.searching.stream = undefined;
    expect(value(await office.bookshelf.search(last, "alpha", "needle-one")).hits).toHaveLength(2);
  });

  test("a failed search frees the person's turn", async () => {
    office.searching.stream = async () => {
      throw new Error("spawn failed");
    };
    await expect(office.bookshelf.search(reader, "alpha", "needle-one")).rejects.toThrow();
    office.searching.stream = undefined;
    expect((await office.bookshelf.search(reader, "alpha", "needle-one")).ok).toBe(true);
  });

  test("a dropped request stops git at once, even one that prints nothing", async () => {
    const dropped = new AbortController();
    const started = performance.now();
    // An alias that sleeps stands in for a search that is still reading.
    const run = streamGit(
      office.mirror,
      ["-c", "alias.slow=!sleep 4", "slow"],
      () => true,
      dropped.signal,
    );
    setTimeout(() => dropped.abort(), 100);
    expect((await run).stopped).toBe(true);
    expect(performance.now() - started).toBeLessThan(2500);
    // Already dropped: git is not started.
    expect(await streamGit(office.mirror, ["version"], () => true, dropped.signal)).toEqual({
      code: 130,
      stopped: true,
    });
    // Through the service: no answer, and the turn is free again.
    const gone = new AbortController();
    office.searching.stream = (mirror, args, onChunk, signal) => {
      gone.abort();
      return streamGit(mirror, args, onChunk, signal);
    };
    expect(error(await office.bookshelf.search(reader, "alpha", "the", gone.signal))).toBe(
      "unavailable",
    );
    office.searching.stream = undefined;
    expect((await office.bookshelf.search(reader, "alpha", "the")).ok).toBe(true);
  });

  test("the reader stops a search when told to", async () => {
    let chunks = 0;
    const stopAtFirst: GitStream = (mirror, args, _onChunk, signal) =>
      streamGit(
        mirror,
        args,
        () => {
          chunks += 1;
          return false;
        },
        signal,
      );
    const out = await stopAtFirst(office.mirror, ["cat-file", "-p", "HEAD"], () => true);
    expect(out.stopped).toBe(true);
    expect(chunks).toBe(1);
  });
});

describe("fetchedAt is when a fetch last worked", () => {
  test("a failed fetch does not count as fresh, and attempts stay limited", async () => {
    const other = startShelfOffice();
    try {
      const rita = other.person("Rita", "member", "read");
      other.fetching.run = async () => {
        throw new Error("remote: Repository not found");
      };
      expect(value(await other.bookshelf.listing(rita, "alpha")).fetchedAt).toBeNull();
      // Asked again at once: no second attempt, and still never fetched.
      expect(value(await other.bookshelf.listing(rita, "alpha")).fetchedAt).toBeNull();
      expect(other.refreshed).toHaveLength(1);

      other.advance(REFRESH_AFTER_MS + 1);
      other.fetching.run = async () => undefined;
      const worked = value(await other.bookshelf.listing(rita, "alpha")).fetchedAt;
      expect(worked).toBeGreaterThan(0);

      other.advance(REFRESH_AFTER_MS + 1);
      other.fetching.run = async () => {
        throw new Error("timeout");
      };
      // The failure leaves the time of the last fetch that worked.
      expect(value(await other.bookshelf.listing(rita, "alpha")).fetchedAt).toBe(worked);
      expect(other.refreshed).toHaveLength(3);
    } finally {
      other.stop();
    }
  });
});

describe("only what was fetched from the remote is read", () => {
  test("commits on the mirror's own branch are not on the shelf; with no remote branch it is empty", async () => {
    const other = startShelfOffice();
    try {
      const rita = other.person("Rita", "member", "read");
      // A mirror that doubled as a clone: a commit on its own branch, never pushed.
      writeFileSync(join(other.mirror, "local-only.md"), "# LOCAL-ONLY-264\n");
      git(other.mirror, "add", "local-only.md");
      git(other.mirror, "commit", "--quiet", "-m", "never pushed");
      expect(git(other.mirror, "ls-tree", "--name-only", BRANCH)).toContain("local-only.md");
      let shelf = value(await other.bookshelf.listing(rita, "alpha"));
      expect(shelf.state).toBe("ready");
      expect(shelf.docs.map((d) => d.path)).not.toContain("local-only.md");
      expect(error(await other.bookshelf.document(rita, "alpha", "local-only.md"))).toBe(
        "not_found",
      );

      // The default branch was renamed upstream: a pruning fetch removes origin/<old name>.
      git(other.mirror, "update-ref", "-d", `refs/remotes/origin/${BRANCH}`);
      shelf = value(await other.bookshelf.listing(rita, "alpha"));
      expect(shelf).toMatchObject({ state: "no_branch", docs: [], total: 0, commit: "" });
      for (const path of ["README.md", "local-only.md"])
        expect(error(await other.bookshelf.document(rita, "alpha", path))).toBe("unavailable");
      const found = await other.bookshelf.search(rita, "alpha", "LOCAL-ONLY-264");
      expect(error(found)).toBe("unavailable");
    } finally {
      other.stop();
    }
  });
});

describe("file names made to read as others", () => {
  test("a path with an invisible format character is not a path", () => {
    for (const ch of INVISIBLE) {
      expect(bookshelfPath(`docs/a${ch}b.md`)).toBeNull();
      expect(bookshelfPath(`${ch}README.md`)).toBeNull();
    }
    expect(bookshelfPath("docs/ž š/日本語.md")).toBe("docs/ž š/日本語.md");
  });

  test("such files are not listed, cannot be opened and never show in a search", async () => {
    const shelf = value(await office.bookshelf.listing(reader, "alpha"));
    const listed = shelf.docs.map((d) => d.path).join("\n");
    expect(listed).not.toContain("harmless");
    expect(listed).not.toContain("width");
    for (const ch of INVISIBLE) expect(JSON.stringify(shelf)).not.toContain(ch);
    expect(error(await office.bookshelf.document(reader, "alpha", SPOOFED))).toBe("bad_path");
    const found = value(await office.bookshelf.search(reader, "alpha", "needle-two"));
    expect(found.hits.map((h) => h.path)).toEqual([".changes/long.md"]);
  });
});
