/**
 * Reading a repo's tree out of the office's own mirror (SPEC §8, D17; #264)
 * with git plumbing: `rev-parse`, `ls-tree`, `cat-file`, `grep` against the
 * mirror's object store. Nothing here looks at a checkout, a person's clone,
 * a henchman's worktree or the network, and no credential is involved.
 *
 * No path from a request is ever handed to git or to the filesystem: the
 * tree is listed once per commit, and a file is then read by the object id
 * the listing gave for it (`cat-file blob <id>`). A symlink in the repo is
 * an entry of mode 120000 whose blob is the link's target text; it is never
 * listed as a document and never followed. Submodules (commits) are skipped.
 *
 * Git runs with hooks and fsmonitor off, no pager, no textconv, no replace
 * refs, no optional locks and the office's isolated git environment.
 */
import { join } from "node:path";
import { gitBaseEnv } from "../github/git.ts";

const READ_TIMEOUT_MS = 15_000;
/** `ls-tree` output read before a listing is called incomplete. */
export const TREE_SCAN_MAX_BYTES = 64 * 1024 * 1024;

export interface TreeEntry {
  path: string;
  /** Object id of the blob. */
  oid: string;
  size: number;
}

export interface GitOutput {
  code: number;
  bytes: Uint8Array;
  /** Output passed `maxBytes` and git was stopped; `bytes` is what arrived before that. */
  overflow: boolean;
}

export type GitReader = (
  mirror: string,
  args: readonly string[],
  maxBytes: number,
) => Promise<GitOutput>;

/** Run one read-only git command in the mirror at `mirror` (a clone's work dir). */
export const readGit: GitReader = async (mirror, args, maxBytes) => {
  const proc = Bun.spawn(
    [
      "git",
      `--git-dir=${join(mirror, ".git")}`,
      "--no-pager",
      "--no-replace-objects",
      "--no-optional-locks",
      "-c",
      `safe.directory=${mirror}`,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      ...args,
    ],
    { cwd: "/", env: gitBaseEnv(), stdin: "ignore", stdout: "pipe", stderr: "ignore" },
  );
  const timer = setTimeout(() => proc.kill("SIGKILL"), READ_TIMEOUT_MS);
  const chunks: Uint8Array[] = [];
  let length = 0;
  let overflow = false;
  try {
    for await (const chunk of proc.stdout) {
      if (length + chunk.length > maxBytes) {
        overflow = true;
        chunks.push(chunk.subarray(0, maxBytes - length));
        proc.kill("SIGKILL");
        break;
      }
      length += chunk.length;
      chunks.push(chunk);
    }
    const code = await proc.exited;
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { code, bytes, overflow };
  } finally {
    clearTimeout(timer);
  }
};

const OID = /^[0-9a-f]{40,64}$/;
/** A branch name the office will put into a ref (it comes from git at clone time). */
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The commit the default branch is at in the mirror (as last fetched), or null. */
export async function resolveCommit(
  git: GitReader,
  mirror: string,
  branch: string,
): Promise<string | null> {
  if (!BRANCH.test(branch) || branch.includes("..")) return null;
  // A clone keeps what it fetched under origin/; its own branch stays where the clone left it.
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const out = await git(
      mirror,
      ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
      256,
    );
    const oid = text(out.bytes).trim();
    if (out.code === 0 && !out.overflow && OID.test(oid)) return oid;
  }
  return null;
}

/**
 * Every regular file of the commit's tree: `mode type oid size<TAB>path`,
 * NUL-separated, paths as raw bytes. Entries that are not regular files
 * (symlinks 120000, submodules 160000) and paths that are not valid UTF-8
 * are left out. `complete` is false when the tree was too big to read whole.
 */
export async function listTree(
  git: GitReader,
  mirror: string,
  commit: string,
): Promise<{ entries: TreeEntry[]; complete: boolean } | null> {
  if (!OID.test(commit)) return null;
  const out = await git(
    mirror,
    ["ls-tree", "-r", "-z", "--long", "--full-tree", "--end-of-options", commit],
    TREE_SCAN_MAX_BYTES,
  );
  if (out.code !== 0 && !out.overflow) return null;
  const entries: TreeEntry[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let start = 0;
  const { bytes } = out;
  // A record cut short by the cap has no NUL after it and is dropped.
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) continue;
    const record = bytes.subarray(start, i);
    start = i + 1;
    const tab = record.indexOf(9);
    if (tab < 0) continue;
    const [mode, type, oid, size] = text(record.subarray(0, tab)).split(/ +/);
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) continue;
    if (!oid || !OID.test(oid) || !/^\d+$/.test(size ?? "")) continue;
    let path: string;
    try {
      path = decoder.decode(record.subarray(tab + 1));
    } catch {
      continue;
    }
    entries.push({ path, oid, size: Number(size) });
  }
  return { entries, complete: !out.overflow };
}

/** A blob's bytes by object id; null when it is missing or larger than `maxBytes`. */
export async function readBlob(
  git: GitReader,
  mirror: string,
  oid: string,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!OID.test(oid)) return null;
  const out = await git(mirror, ["cat-file", "blob", oid], maxBytes);
  return out.code === 0 && !out.overflow ? out.bytes : null;
}

export interface GrepLine {
  path: string;
  line: number;
  text: string;
}

/** Pathspecs for the documents a search covers: the office's constants, never a request's. */
export const DOC_PATHSPECS = [":(icase)*.md", ":(icase)*.markdown"] as const;

/**
 * Lines of the commit's Markdown files that contain `needle` (fixed text,
 * case-insensitive). The needle travels as its own argument after `-e`, so
 * it is never an option and never a pattern. Null when git failed.
 */
export async function grepTree(
  git: GitReader,
  mirror: string,
  commit: string,
  needle: string,
  maxBytes: number,
): Promise<{ lines: GrepLine[]; overflow: boolean } | null> {
  if (!OID.test(commit)) return null;
  const out = await git(
    mirror,
    [
      "grep",
      "-I",
      "-i",
      "-n",
      "-z",
      "--full-name",
      "--no-color",
      "--no-textconv",
      "--fixed-strings",
      "--max-count=20",
      "-e",
      needle,
      commit,
      "--",
      ...DOC_PATHSPECS,
    ],
    maxBytes,
  );
  // 1: nothing matched.
  if (out.code === 1 && !out.overflow) return { lines: [], overflow: false };
  if (out.code !== 0 && !out.overflow) return null;
  // `<commit>:<path>\0<line>\0<text>\n`; after an overflow the last record is cut short.
  const records = text(out.bytes).split("\n");
  if (out.overflow) records.pop();
  const lines: GrepLine[] = [];
  const prefix = `${commit}:`;
  for (const record of records) {
    const [name, line, ...rest] = record.split("\0");
    if (!name?.startsWith(prefix) || !/^\d+$/.test(line ?? "")) continue;
    lines.push({ path: name.slice(prefix.length), line: Number(line), text: rest.join(" ") });
  }
  return { lines, overflow: out.overflow };
}
