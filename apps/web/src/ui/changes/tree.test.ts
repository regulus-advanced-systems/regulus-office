import { describe, expect, test } from "bun:test";
import type { ChangedFile } from "@regulus/protocol";
import { buildTree, type DirNode } from "./tree.ts";

const f = (path: string): ChangedFile => ({
  path,
  kind: "modified",
  uncommitted: false,
  additions: 1,
  deletions: 0,
  binary: false,
  symlink: false,
  sig: null,
});

const shape = (dir: DirNode): unknown =>
  dir.children.map((c) => (c.type === "dir" ? { [c.name]: shape(c) } : c.name));

describe("buildTree", () => {
  test("directories first, sorted, single-child directories joined", () => {
    const tree = buildTree([
      f("z.md"),
      f("apps/web/src/ui/changes/a.ts"),
      f("apps/web/src/ui/changes/b.ts"),
      f("apps/server/x.ts"),
      f("README.md"),
    ]);
    expect(shape(tree)).toEqual([
      { apps: [{ server: ["x.ts"] }, { "web/src/ui/changes": ["a.ts", "b.ts"] }] },
      "README.md",
      "z.md",
    ]);
  });

  test("file nodes keep their full path and entry", () => {
    const tree = buildTree([f("a/b.txt")]);
    const dir = tree.children[0] as DirNode;
    expect(dir.path).toBe("a");
    expect(dir.children[0]).toMatchObject({ type: "file", path: "a/b.txt", name: "b.txt" });
  });

  test("empty list", () => {
    expect(buildTree([]).children).toEqual([]);
  });
});
