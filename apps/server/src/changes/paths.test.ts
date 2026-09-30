import { describe, expect, test } from "bun:test";
import { ChangesHttpError, checkRepoPath, resolvesInside } from "./paths.ts";

const refused = (p: unknown) => {
  try {
    checkRepoPath(p);
  } catch (err) {
    return err instanceof ChangesHttpError && err.code === "invalid_path" && err.status === 400;
  }
  return false;
};

describe("checkRepoPath", () => {
  test("plain relative paths pass unchanged, odd characters included", () => {
    for (const p of [
      "a.txt",
      "src/deep/file.ts",
      "new file *.txt",
      ":(glob)x",
      "-rf",
      "a..b",
      ".env.example",
      "dir/.gitignore",
    ]) {
      expect(checkRepoPath(p)).toBe(p);
    }
  });

  test("traversal, absolute, empty segments, NUL and .git are refused", () => {
    for (const p of [
      "",
      "../x",
      "a/../../x",
      "..",
      ".",
      "./a",
      "a//b",
      "a/",
      "/etc/passwd",
      "a\0b",
      ".git/config",
      "sub/.GIT/hooks/pre-commit",
      "x".repeat(5000),
      42,
      null,
    ]) {
      expect(refused(p)).toBe(true);
    }
  });
});

describe("resolvesInside", () => {
  test("only an exact resolution under the worktree passes", () => {
    expect(resolvesInside("/w/a1\0/w/a1/img.png\0", "img.png")).toBe(true);
    expect(resolvesInside("/w/a1\0/w/a1/d/img.png\0", "d/img.png")).toBe(true);
    // A symlinked file or directory resolves elsewhere.
    expect(resolvesInside("/w/a1\0/home/u/.claude/creds.json\0", "img.png")).toBe(false);
    expect(resolvesInside("/w/a1\0/w/a1/other/img.png\0", "d/img.png")).toBe(false);
    expect(resolvesInside("/w/a1\0", "img.png")).toBe(false);
    expect(resolvesInside("", "img.png")).toBe(false);
    expect(resolvesInside("relative\0relative/img.png\0", "img.png")).toBe(false);
  });
});
