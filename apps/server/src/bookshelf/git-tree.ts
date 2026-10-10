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
import { LineExcerpt } from "./excerpt.ts";

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

/**
 * Run one read-only git command and hand its output over as it arrives.
 * `onChunk` returning false stops git at once, as does `signal` (the
 * request was dropped) and the time limit.
 */
export type GitStream = (
  mirror: string,
  args: readonly string[],
  onChunk: (chunk: Uint8Array) => boolean,
  signal?: AbortSignal,
) => Promise<{ code: number; stopped: boolean }>;

/** Run one read-only git command in the mirror at `mirror` (a clone's work dir). */
export const streamGit: GitStream = async (mirror, args, onChunk, signal) => {
  if (signal?.aborted) return { code: 130, stopped: true };
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
  let stopped = false;
  let halt = () => undefined as void;
  const halted = new Promise<null>((resolve) => {
    halt = () => resolve(null);
  });
  const stop = () => {
    stopped = true;
    proc.kill("SIGKILL");
    halt();
  };
  const timer = setTimeout(stop, READ_TIMEOUT_MS);
  signal?.addEventListener("abort", stop, { once: true });
  const reader = proc.stdout.getReader();
  try {
    while (!stopped) {
      // Not only the next chunk: a stop must not wait for output that never comes.
      const read = await Promise.race([reader.read(), halted]);
      if (!read || read.done) break;
      if (!onChunk(read.value)) stop();
    }
    return { code: await proc.exited, stopped };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    void reader.cancel().catch(() => undefined);
  }
};

/** {@link streamGit}, collected: at most `maxBytes` of output. */
export const readGit: GitReader = async (mirror, args, maxBytes) => {
  const chunks: Uint8Array[] = [];
  let length = 0;
  let overflow = false;
  const { code } = await streamGit(mirror, args, (chunk) => {
    if (length + chunk.length > maxBytes) {
      overflow = true;
      chunks.push(chunk.subarray(0, maxBytes - length));
      return false;
    }
    length += chunk.length;
    chunks.push(chunk);
    return true;
  });
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { code, bytes, overflow };
};

const OID = /^[0-9a-f]{40,64}$/;
/** A branch name the office will put into a ref (it comes from git at clone time). */
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * The commit the default branch is at in the mirror as last fetched; `"missing"` when the
 * mirror has no such remote branch; null when the mirror cannot be read.
 */
export async function resolveCommit(
  git: GitReader,
  mirror: string,
  branch: string,
): Promise<string | null> {
  if (!BRANCH.test(branch) || branch.includes("..")) return null;
  // Only what the office fetched from the remote. The mirror's own branches are never read:
  // in a mirror from before #114 that doubled as a clone they may hold commits never pushed.
  const out = await git(
    mirror,
    [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `refs/remotes/origin/${branch}^{commit}`,
    ],
    256,
  );
  const oid = text(out.bytes).trim();
  if (out.code === 0 && !out.overflow && OID.test(oid)) return oid;
  // `rev-parse --verify --quiet` exits 1 for a ref that is not there (128: not a repository).
  return out.code === 1 ? "missing" : null;
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

export interface GrepOptions {
  /** Stop after this many lines. */
  maxLines: number;
  /** Keep this many bytes of each line; the rest of a long line is read past, not kept. */
  lineBytes: number;
  /** The request was dropped: stop git. */
  signal?: AbortSignal;
}

const NUL = 0;
const NEWLINE = 10;
/** Longest `<commit>:<path>` or line number the parser keeps, bytes. */
const FIELD_BYTES = 8192;

/**
 * Lines of the given files of the commit that contain `needle` (fixed
 * text, case-insensitive). Null when git failed.
 *
 * - The needle travels as its own argument after `-e`: never an option,
 *   never a pattern.
 * - `paths` are the office's own listing of the tree (never a request's
 *   text) and are taken literally (`--literal-pathspecs`), so only those
 *   files are read. With none, nothing is searched.
 * - Output is parsed as it arrives (`<commit>:<path>\0<line>\0<text>\n`):
 *   of a long line only the part that shows the match is kept;
 *   at most `lineBytes` of a line are kept however long it is, and git is
 *   stopped at `maxLines` lines. `more` says it was stopped there.
 */
export async function grepTree(
  stream: GitStream,
  mirror: string,
  commit: string,
  needle: string,
  paths: readonly string[],
  options: GrepOptions,
): Promise<{ lines: GrepLine[]; more: boolean } | null> {
  if (!OID.test(commit)) return null;
  if (paths.length === 0) return { lines: [], more: false };
  const lines: GrepLine[] = [];
  const prefix = `${commit}:`;
  // The record being read: name and line number, each cut at its cap, and the line's
  // text, of which the excerpt keeps the part that shows the match (excerpt.ts).
  const fields: number[][] = [[], []];
  const excerpt = new LineExcerpt(needle, options.lineBytes);
  let field = 0;
  let more = false;
  const caps = [FIELD_BYTES, 32];
  const finish = () => {
    const [name, line] = fields.map((bytes) => text(Uint8Array.from(bytes))) as [string, string];
    const body = excerpt.take();
    for (const bytes of fields) bytes.length = 0;
    field = 0;
    if (name.startsWith(prefix) && /^\d+$/.test(line))
      lines.push({ path: name.slice(prefix.length), line: Number(line), text: body });
  };
  const { code, stopped } = await stream(
    mirror,
    [
      "--literal-pathspecs",
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
      ...paths,
    ],
    (chunk) => {
      for (const byte of chunk) {
        if (byte === NEWLINE && field === 2) {
          if (lines.length >= options.maxLines) {
            more = true;
            return false;
          }
          finish();
        } else if (byte === NUL && field < 2) field += 1;
        else if (field === 2) excerpt.push(byte);
        else if ((fields[field] as number[]).length < (caps[field] as number))
          (fields[field] as number[]).push(byte);
      }
      return true;
    },
    options.signal,
  );
  if (more) return { lines, more };
  // Stopped by the time limit or a dropped request: what was found is not the whole answer.
  if (stopped) return options.signal?.aborted ? null : { lines, more: true };
  // 1: nothing matched.
  return code === 0 || code === 1 ? { lines, more: false } : null;
}
