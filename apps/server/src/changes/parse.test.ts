import { describe, expect, test } from "bun:test";
import { parseRawNumstat, parseStat, parseStatusV2, parseUnifiedDiff } from "./parse.ts";

const Z = "\0";

describe("parseStatusV2", () => {
  test("branch headers, ordinary, rename, unmerged and untracked entries", () => {
    const out = [
      "# branch.oid 1234567890abcdef1234567890abcdef12345678",
      "# branch.head office/fix",
      "# branch.upstream origin/office/fix",
      "1 .M N... 100644 100644 100644 aaa aaa README.md",
      "1 A. N... 000000 100644 100644 000 bbb dir/new file.txt",
      "1 .D N... 100644 100644 000000 ccc ccc gone.txt",
      "1 T. N... 100644 120000 120000 ddd eee link",
      "2 R. N... 100644 100644 100644 fff fff R100 to.txt",
      "from.txt",
      "u UU N... 100644 100644 100644 100644 g1 g2 g3 both.txt",
      "? untracked with\nnewline.md",
      "! ignored.log",
      "",
    ].join(Z);
    const s = parseStatusV2(out);
    expect(s.head).toBe("1234567890abcdef1234567890abcdef12345678");
    expect(s.branch).toBe("office/fix");
    expect(s.entries).toEqual([
      { path: "README.md", kind: "modified" },
      { path: "dir/new file.txt", kind: "added" },
      { path: "gone.txt", kind: "deleted" },
      { path: "link", kind: "typechange" },
      { path: "to.txt", kind: "added" },
      { path: "from.txt", kind: "deleted" },
      { path: "both.txt", kind: "conflicted" },
      { path: "untracked with\nnewline.md", kind: "untracked" },
    ]);
  });

  test("unborn and detached heads", () => {
    const s = parseStatusV2(["# branch.oid (initial)", "# branch.head (detached)", ""].join(Z));
    expect(s.head).toBeNull();
    expect(s.branch).toBeNull();
    expect(s.entries).toEqual([]);
  });
});

describe("parseRawNumstat", () => {
  test("raw entries give kind and symlinks; numstat adds line counts and binary", () => {
    const sha = "0".repeat(40);
    const out = [
      `:100644 100644 ${sha} ${sha} M`,
      "src/a b.ts",
      `:000000 100644 ${sha} ${sha} A`,
      "new.png",
      `:100644 000000 ${sha} ${sha} D`,
      "old.txt",
      `:000000 120000 ${sha} ${sha} A`,
      "link",
      "3\t1\tsrc/a b.ts",
      "-\t-\tnew.png",
      "0\t4\told.txt",
      "1\t0\tlink",
      "",
    ].join(Z);
    expect(parseRawNumstat(out)).toEqual([
      {
        path: "src/a b.ts",
        kind: "modified",
        symlink: false,
        additions: 3,
        deletions: 1,
        binary: false,
      },
      {
        path: "new.png",
        kind: "added",
        symlink: false,
        additions: null,
        deletions: null,
        binary: true,
      },
      {
        path: "old.txt",
        kind: "deleted",
        symlink: false,
        additions: 0,
        deletions: 4,
        binary: false,
      },
      { path: "link", kind: "added", symlink: true, additions: 1, deletions: 0, binary: false },
    ]);
  });

  test("a path that looks like a numstat line is still read as a path", () => {
    const sha = "0".repeat(40);
    const out = [`:100644 100644 ${sha} ${sha} M`, "1\t2\tx", "5\t6\t1\t2\tx", ""].join(Z);
    expect(parseRawNumstat(out)).toEqual([
      {
        path: "1\t2\tx",
        kind: "modified",
        symlink: false,
        additions: 5,
        deletions: 6,
        binary: false,
      },
    ]);
  });

  test("renames (if ever produced) are keyed by the new path", () => {
    const sha = "0".repeat(40);
    const out = [
      `:100644 100644 ${sha} ${sha} R090`,
      "a.txt",
      "b.txt",
      "1\t1\t",
      "a.txt",
      "b.txt",
      "",
    ].join(Z);
    expect(parseRawNumstat(out)).toEqual([
      {
        path: "b.txt",
        kind: "modified",
        symlink: false,
        additions: 1,
        deletions: 1,
        binary: false,
      },
    ]);
  });
});

describe("parseStat", () => {
  test("mode, fingerprint and names with spaces", () => {
    const out = [
      "81a4 12 345 1790000000.123456789 1790000001.000000001 a file.txt",
      "a1ff 6 346 1790000000.1 1790000000.2 link",
      "",
    ].join(Z);
    const m = parseStat(out);
    expect(m.get("a file.txt")).toEqual({
      regular: true,
      symlink: false,
      sig: "12:345:1790000000.123456789:1790000001.000000001",
    });
    expect(m.get("link")?.symlink).toBe(true);
    expect(m.get("link")?.regular).toBe(false);
  });
});

describe("parseUnifiedDiff", () => {
  const patch = [
    "diff --git a/f.txt b/f.txt",
    "index 111..222 100644",
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1,3 +1,4 @@ function x() {",
    " one",
    "-two",
    "+TWO",
    "+2.5",
    " three",
    "@@ -10 +11 @@",
    "-last",
    "+LAST",
    "\\ No newline at end of file",
    "",
  ].join("\n");

  test("hunks with line numbers and notes", () => {
    const d = parseUnifiedDiff(patch);
    expect(d.binary).toBe(false);
    expect(d.truncated).toBe(false);
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 });
    expect(d.hunks[0]?.lines).toEqual([
      { t: "ctx", text: "one", old: 1, new: 1 },
      { t: "del", text: "two", old: 2 },
      { t: "add", text: "TWO", new: 2 },
      { t: "add", text: "2.5", new: 3 },
      { t: "ctx", text: "three", old: 3, new: 4 },
    ]);
    expect(d.hunks[1]).toMatchObject({ oldStart: 10, oldLines: 1, newStart: 11, newLines: 1 });
    expect(d.hunks[1]?.lines.at(-1)).toEqual({ t: "note", text: "No newline at end of file" });
  });

  test("line cap marks the diff truncated", () => {
    const d = parseUnifiedDiff(patch, 3);
    expect(d.truncated).toBe(true);
    expect(d.hunks.flatMap((h) => h.lines)).toHaveLength(3);
  });

  test("binary files", () => {
    const d = parseUnifiedDiff("diff --git a/x b/x\nBinary files /dev/null and b/x differ\n");
    expect(d.binary).toBe(true);
    expect(d.hunks).toEqual([]);
  });

  test("new file hunks count from 1; CRLF text is kept", () => {
    const d = parseUnifiedDiff("--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+a\r\n+b\n");
    expect(d.hunks[0]?.lines).toEqual([
      { t: "add", text: "a\r", new: 1 },
      { t: "add", text: "b", new: 2 },
    ]);
  });
});
