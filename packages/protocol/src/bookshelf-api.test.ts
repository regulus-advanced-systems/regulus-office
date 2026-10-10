import { describe, expect, test } from "bun:test";
import {
  BOOKSHELF_LIMITS,
  bookshelfDocApiPath,
  bookshelfPath,
  isBookshelfDocPath,
  isBookshelfImagePath,
  resolveBookshelfLink,
} from "./bookshelf-api.ts";

describe("bookshelfPath", () => {
  test("keeps plain paths inside the tree", () => {
    for (const ok of [
      "README.md",
      "docs/SPEC.md",
      "docs/adr/0001 first.md",
      "a/b/c/d.png",
      "ž/š.md",
    ])
      expect(bookshelfPath(ok)).toBe(ok);
  });

  test("refuses everything that is not a path inside the tree", () => {
    for (const bad of [
      "",
      "/etc/passwd",
      "/README.md",
      "..",
      "../README.md",
      "docs/../../etc/passwd",
      "docs/./a.md",
      "docs//a.md",
      "docs/",
      "docs\\..\\a.md",
      "C:\\Windows\\win.ini",
      "a\u0000.md",
      "a\n.md",
      "a\u007f.md",
      ".git/config",
      "sub/.GIT/HEAD",
      "x".repeat(BOOKSHELF_LIMITS.pathMax + 1),
      null,
      undefined,
      7,
      ["README.md"],
    ])
      expect(bookshelfPath(bad)).toBeNull();
  });

  test("what counts as a document and as a picture goes by the ending", () => {
    expect(isBookshelfDocPath("README.md")).toBe(true);
    expect(isBookshelfDocPath("docs/GUIDE.MARKDOWN")).toBe(true);
    expect(isBookshelfDocPath(".md")).toBe(false);
    expect(isBookshelfDocPath("notes.md.txt")).toBe(false);
    expect(isBookshelfDocPath("index.html")).toBe(false);
    expect(isBookshelfImagePath("docs/a.PNG")).toBe(true);
    expect(isBookshelfImagePath("docs/a.svg")).toBe(false);
  });
});

describe("resolveBookshelfLink", () => {
  const from = "docs/guide/start.md";

  test("relative links resolve against the document's directory", () => {
    expect(resolveBookshelfLink(from, "next.md")).toEqual({
      path: "docs/guide/next.md",
      anchor: "",
    });
    expect(resolveBookshelfLink(from, "./next.md#Setup")).toEqual({
      path: "docs/guide/next.md",
      anchor: "Setup",
    });
    expect(resolveBookshelfLink(from, "../adr/0001.md")).toEqual({
      path: "docs/adr/0001.md",
      anchor: "",
    });
    expect(resolveBookshelfLink(from, "../../README.md")).toEqual({
      path: "README.md",
      anchor: "",
    });
    expect(resolveBookshelfLink(from, "/CONTRIBUTING.md")).toEqual({
      path: "CONTRIBUTING.md",
      anchor: "",
    });
    expect(resolveBookshelfLink(from, "my%20notes.md?plain=1#a%20b")).toEqual({
      path: "docs/guide/my notes.md",
      anchor: "a b",
    });
    expect(resolveBookshelfLink(from, "#here")).toEqual({ path: from, anchor: "here" });
    expect(resolveBookshelfLink("README.md", "docs/img/a.png")).toEqual({
      path: "docs/img/a.png",
      anchor: "",
    });
  });

  test("nothing climbs out of the repo, and nothing with a scheme or a host is a path", () => {
    for (const bad of [
      "",
      "../../../etc/passwd",
      "../../..",
      "/../x.md",
      "%2e%2e/%2e%2e/%2e%2e/etc/passwd",
      "..%2f..%2f..%2fetc%2fpasswd",
      "a%00.md",
      "%zz.md",
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>1</script>",
      "vbscript:x",
      "file:///etc/passwd",
      "https://evil.example/a.md",
      "//evil.example/a.md",
      "\\\\evil\\share",
      "a\\b.md",
      "a\tb.md",
      ".git/config",
      "../../.git/HEAD",
    ])
      expect(resolveBookshelfLink(from, bad)).toBeNull();
    // Encoded separators are decoded before the path is walked, not after.
    expect(resolveBookshelfLink(from, "..%2fadr%2f0001.md")).toEqual({
      path: "docs/adr/0001.md",
      anchor: "",
    });
  });

  test("the API path carries the document path as one encoded parameter", () => {
    expect(bookshelfDocApiPath("op 1", "docs/a b&c.md")).toBe(
      "/api/operations/op%201/docs/file?path=docs%2Fa%20b%26c.md",
    );
  });
});
