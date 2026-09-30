/**
 * Parsers for the git and coreutils output the changes window reads (#38).
 * Everything is NUL-separated (`-z`, `--printf ...\0`), so paths with
 * spaces, quotes or newlines come through unchanged.
 */
import type { ChangeKind, DiffHunk, DiffLine } from "@regulus/protocol";

export interface StatusEntry {
  path: string;
  kind: ChangeKind;
}

export interface StatusResult {
  /** Branch name, null when detached. */
  branch: string | null;
  /** HEAD commit, null before the first commit. */
  head: string | null;
  entries: StatusEntry[];
}

function kindOf(xy: string): ChangeKind {
  const code = xy[1] !== "." && xy[1] !== undefined ? xy[1] : xy[0];
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "T":
      return "typechange";
    default:
      return "modified";
  }
}

/** Skip `n` space-separated fields; the rest is the path (which may contain spaces). */
function afterFields(entry: string, n: number): string | null {
  let at = 0;
  for (let i = 0; i < n; i++) {
    at = entry.indexOf(" ", at);
    if (at < 0) return null;
    at++;
  }
  return entry.slice(at);
}

/** `git status --porcelain=v2 -z --branch --untracked-files=all [--no-renames]`. */
export function parseStatusV2(out: string): StatusResult {
  const result: StatusResult = { branch: null, head: null, entries: [] };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? "";
    if (entry.length === 0) continue;
    const tag = entry[0];
    if (tag === "#") {
      const [, key, value] = /^# (\S+) (.*)$/.exec(entry) ?? [];
      if (key === "branch.oid" && value && value !== "(initial)") result.head = value;
      if (key === "branch.head" && value && value !== "(detached)") result.branch = value;
    } else if (tag === "1") {
      const path = afterFields(entry, 8);
      if (path) result.entries.push({ path, kind: kindOf(entry.slice(2, 4)) });
    } else if (tag === "2") {
      // A rename (only without --no-renames): the original path follows as its own field.
      const path = afterFields(entry, 9);
      if (path) result.entries.push({ path, kind: "added" });
      const orig = parts[++i];
      if (orig) result.entries.push({ path: orig, kind: "deleted" });
    } else if (tag === "u") {
      const path = afterFields(entry, 10);
      if (path) result.entries.push({ path, kind: "conflicted" });
    } else if (tag === "?") {
      result.entries.push({ path: entry.slice(2), kind: "untracked" });
    }
  }
  return result;
}

export interface DiffEntry {
  path: string;
  kind: ChangeKind;
  symlink: boolean;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

const RAW = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/;
const NUMSTAT = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;

function rawKind(letter: string): ChangeKind {
  switch (letter) {
    case "A":
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "T":
      return "typechange";
    case "U":
      return "conflicted";
    default:
      return "modified";
  }
}

/** `git diff --raw --numstat -z --no-renames <base>`: raw entries first, then numstat. */
export function parseRawNumstat(out: string): DiffEntry[] {
  const byPath = new Map<string, DiffEntry>();
  const parts = out.split("\0");
  let i = 0;
  while (i < parts.length) {
    const token = parts[i] ?? "";
    const raw = RAW.exec(token);
    if (raw) {
      const path = parts[i + 1] ?? "";
      const letter = raw[3] ?? "M";
      const paths = letter === "R" || letter === "C" ? [parts[i + 2] ?? ""] : [path];
      for (const p of paths) {
        if (!p) continue;
        byPath.set(p, {
          path: p,
          kind: rawKind(letter),
          symlink: raw[1] === "120000" || raw[2] === "120000",
          additions: null,
          deletions: null,
          binary: false,
        });
      }
      i += letter === "R" || letter === "C" ? 3 : 2;
      continue;
    }
    const num = NUMSTAT.exec(token);
    if (num) {
      let path = num[3] ?? "";
      let step = 1;
      if (path === "") {
        // A rename in numstat: `a\td\t\0src\0dst`.
        path = parts[i + 2] ?? "";
        step = 3;
      }
      const entry = byPath.get(path);
      if (entry) {
        entry.binary = num[1] === "-";
        entry.additions = num[1] === "-" ? null : Number(num[1]);
        entry.deletions = num[2] === "-" ? null : Number(num[2]);
      }
      i += step;
      continue;
    }
    i++;
  }
  return [...byPath.values()];
}

export interface StatInfo {
  symlink: boolean;
  regular: boolean;
  /** size:inode:mtime:ctime, from lstat. */
  sig: string;
}

/** `stat --printf '%f %s %i %.9Y %.9Z %n\0' -- <paths>` (lstat: symlinks are not followed). */
export const STAT_FORMAT = "%f %s %i %.9Y %.9Z %n\\0";

export function parseStat(out: string): Map<string, StatInfo> {
  const map = new Map<string, StatInfo>();
  for (const entry of out.split("\0")) {
    if (!entry) continue;
    const m = /^([0-9a-f]+) (\d+) (\d+) ([\d.]+) ([\d.]+) ([\s\S]+)$/.exec(entry);
    if (!m) continue;
    const mode = Number.parseInt(m[1] ?? "0", 16) & 0xf000;
    map.set(m[6] ?? "", {
      symlink: mode === 0xa000,
      regular: mode === 0x8000,
      sig: `${m[2]}:${m[3]}:${m[4]}:${m[5]}`,
    });
  }
  return map;
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  binary: boolean;
  truncated: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** A unified diff for one file into hunks, keeping at most `maxLines` lines. */
export function parseUnifiedDiff(patch: string, maxLines = 5000): ParsedDiff {
  const result: ParsedDiff = { hunks: [], binary: false, truncated: false };
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let kept = 0;
  for (const line of lines) {
    const head = HUNK.exec(line);
    if (head) {
      if (kept >= maxLines) {
        result.truncated = true;
        break;
      }
      hunk = {
        header: line,
        oldStart: Number(head[1]),
        oldLines: head[2] === undefined ? 1 : Number(head[2]),
        newStart: Number(head[3]),
        newLines: head[4] === undefined ? 1 : Number(head[4]),
        lines: [],
      };
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      result.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (line.startsWith("Binary files ") || line === "GIT binary patch") result.binary = true;
      continue;
    }
    if (kept >= maxLines) {
      result.truncated = true;
      break;
    }
    const sign = line[0];
    const text = line.slice(1);
    let out: DiffLine | null = null;
    if (sign === " ") out = { t: "ctx", text, old: oldNo++, new: newNo++ };
    else if (sign === "+") out = { t: "add", text, new: newNo++ };
    else if (sign === "-") out = { t: "del", text, old: oldNo++ };
    else if (sign === "\\") out = { t: "note", text: text.trim() };
    else if (line.startsWith("diff --git ")) {
      // A second file (never expected: one path per request).
      hunk = null;
      continue;
    }
    if (out) {
      hunk.lines.push(out);
      kept++;
    }
  }
  return result;
}
