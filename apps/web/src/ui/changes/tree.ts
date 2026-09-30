/**
 * The changes window's file tree (#38): changed files grouped under their
 * directories, directories first, each level sorted by name. Directories
 * with a single child directory are joined (`src/ui/changes`), as in most
 * review tools, so deep paths stay readable.
 */
import type { ChangedFile, ChangeKind } from "@regulus/protocol";

export interface DirNode {
  type: "dir";
  /** Full path of the directory ("" for the root). */
  path: string;
  /** What the row shows: one or more joined segments. */
  name: string;
  children: TreeNode[];
}

export interface FileNode {
  type: "file";
  path: string;
  name: string;
  file: ChangedFile;
}

export type TreeNode = DirNode | FileNode;

export function buildTree(files: readonly ChangedFile[]): DirNode {
  const root: DirNode = { type: "dir", path: "", name: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = dir.children.find((c): c is DirNode => c.type === "dir" && c.path === path);
      if (!next) {
        next = { type: "dir", path, name: parts[i] ?? "", children: [] };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ type: "file", path: file.path, name: parts.at(-1) ?? file.path, file });
  }
  return compact(sortTree(root));
}

function sortTree(dir: DirNode): DirNode {
  dir.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  for (const c of dir.children) if (c.type === "dir") sortTree(c);
  return dir;
}

function compact(dir: DirNode): DirNode {
  dir.children = dir.children.map((c) => {
    if (c.type !== "dir") return c;
    let node = c;
    while (node.children.length === 1 && node.children[0]?.type === "dir") {
      const only = node.children[0];
      node = { ...only, name: `${node.name}/${only.name}` };
    }
    return compact(node);
  });
  return dir;
}

/** One-letter badge per kind, as `git status` shows it. */
export const KIND_BADGE: Record<ChangeKind, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  typechange: "T",
  untracked: "U",
  conflicted: "!",
};

export const KIND_LABEL: Record<ChangeKind, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  typechange: "type changed",
  untracked: "new, untracked",
  conflicted: "conflicted",
};
