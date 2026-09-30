/**
 * REST shapes for a robot's changes window (#38; SPEC §10 M2, D10).
 *
 * The window polls the robot's worktree while it is open: `git status` and
 * the diff against the merge-base with the repo's default branch, run as the
 * robot's owner inside their runner or the robot's sandbox (SPEC §8, D17,
 * D18), never by the office on their files.
 *
 * Everyone who can see the robot's floor (the audience that watches its
 * terminal) may read the file list, per-file diffs and image previews.
 * Commit and discard are the robot's owner's alone (D12), checked on the
 * server, same-origin and audited. Push + PR is the existing `agent.pr`
 * command (#112).
 *
 *   GET  /api/agents/:agentId/changes                         snapshot
 *   GET  /api/agents/:agentId/changes/file?path=              one file's diff
 *   GET  /api/agents/:agentId/changes/blob?path=&side=        image bytes (octet-stream)
 *   POST /api/agents/:agentId/changes/commit    { message, files: [{ path, sig }] }
 *   POST /api/agents/:agentId/changes/discard   { path, sig }
 *
 * `sig` is the working-tree fingerprint the viewer saw (size, inode, mtime,
 * ctime, from lstat). The server refuses with `changed_since_viewed` when a
 * file changed after the human looked at it, so a concurrent robot edit is
 * reported instead of being committed or thrown away unseen.
 */
import { z } from "zod";
import { Count, TimestampMs } from "./common.ts";

export const CHANGES_POLL_MS = 2000;
/** Files listed at most; beyond this the snapshot says `truncated`. */
export const CHANGES_MAX_FILES = 2000;
/** Files one commit may name. */
export const CHANGES_COMMIT_MAX_FILES = 500;
export const COMMIT_MESSAGE_MAX = 5000;
/** Largest image the preview fetches (bytes). */
export const CHANGES_BLOB_MAX_BYTES = 5 * 1024 * 1024;

export function changesPath(agentId: string, sub?: "file" | "blob" | "commit" | "discard"): string {
  const base = `/api/agents/${encodeURIComponent(agentId)}/changes`;
  return sub ? `${base}/${sub}` : base;
}

/** A path relative to the worktree, as git prints it (validated again on the server). */
export const RepoPath = z.string().min(1).max(4096);

/** Renames show as a deletion plus an addition, as `git status --no-renames` lists them. */
export const CHANGE_KINDS = [
  "added",
  "modified",
  "deleted",
  "typechange",
  "untracked",
  "conflicted",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const ChangedFile = z.object({
  path: RepoPath,
  kind: z.enum(CHANGE_KINDS),
  /** Has changes that are not committed yet (staged, unstaged or untracked): commit/discard apply. */
  uncommitted: z.boolean(),
  /** Lines against the merge-base; null when unknown (untracked, binary). */
  additions: Count.nullable(),
  deletions: Count.nullable(),
  binary: z.boolean(),
  symlink: z.boolean(),
  /** Working-tree fingerprint of an uncommitted file; null when it has none (deleted). */
  sig: z.string().max(200).nullable(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const ChangesSnapshot = z.object({
  agentId: z.string(),
  /** Checked-out branch, null when detached. */
  branch: z.string().nullable(),
  head: z.string().nullable(),
  /** `origin/<default>` and the merge-base the diff is taken against (null: no base, HEAD used). */
  base: z.object({ ref: z.string(), sha: z.string().nullable() }),
  /** Commits on the branch since the merge-base. */
  ahead: Count,
  files: z.array(ChangedFile),
  truncated: z.boolean(),
  polledAt: TimestampMs,
  /** Whether the caller may commit and discard (the robot's owner, D12). */
  canWrite: z.boolean(),
});
export type ChangesSnapshot = z.infer<typeof ChangesSnapshot>;

export const DIFF_LINE_KINDS = ["ctx", "add", "del", "note"] as const;
export const DiffLine = z.object({
  t: z.enum(DIFF_LINE_KINDS),
  text: z.string(),
  /** Line numbers on the base / working side. */
  old: z.number().int().positive().optional(),
  new: z.number().int().positive().optional(),
});
export type DiffLine = z.infer<typeof DiffLine>;

export const DiffHunk = z.object({
  header: z.string(),
  oldStart: Count,
  oldLines: Count,
  newStart: Count,
  newLines: Count,
  lines: z.array(DiffLine),
});
export type DiffHunk = z.infer<typeof DiffHunk>;

export const IMAGE_SIDES = ["base", "work"] as const;
export type ImageSide = (typeof IMAGE_SIDES)[number];

export const FileDiff = z.object({
  path: RepoPath,
  kind: z.enum(CHANGE_KINDS),
  binary: z.boolean(),
  symlink: z.boolean(),
  /** The diff was larger than the office shows; only the stats are known. */
  tooLarge: z.boolean(),
  /** Some lines were cut (`hunks` holds the first part). */
  truncated: z.boolean(),
  hunks: z.array(DiffHunk),
  /** For image files: which sides can be previewed through the blob route. */
  image: z.object({ base: z.boolean(), work: z.boolean() }).nullable(),
});
export type FileDiff = z.infer<typeof FileDiff>;

export const FileSig = z.object({ path: RepoPath, sig: z.string().max(200).nullable() });
export type FileSig = z.infer<typeof FileSig>;

export const CommitChangesRequest = z.object({
  message: z.string().trim().min(1).max(COMMIT_MESSAGE_MAX),
  files: z.array(FileSig).min(1).max(CHANGES_COMMIT_MAX_FILES),
});
export type CommitChangesRequest = z.infer<typeof CommitChangesRequest>;

export const CommitChangesResponse = z.object({ sha: z.string(), files: Count });
export type CommitChangesResponse = z.infer<typeof CommitChangesResponse>;

export const DiscardChangeRequest = FileSig;
export type DiscardChangeRequest = z.infer<typeof DiscardChangeRequest>;

export const DiscardChangeResponse = z.object({ discarded: RepoPath });
export type DiscardChangeResponse = z.infer<typeof DiscardChangeResponse>;

export const CHANGES_ERRORS = [
  "unauthorized",
  "not_found",
  "owner_only",
  "origin_mismatch",
  "invalid_body",
  "invalid_path",
  /** The file is not among the robot's current changes (or has no uncommitted part). */
  "not_changed",
  /** The file changed after the human looked at it; `files` lists which. */
  "changed_since_viewed",
  /** The robot's own git holds the index lock; try again. */
  "git_busy",
  /** The robot's workspace cannot be reached (no worktree, runner down, legacy layout). */
  "unavailable",
  "git_failed",
  "not_image",
  "too_large",
] as const;
export type ChangesError = (typeof CHANGES_ERRORS)[number];

/** Image formats the preview shows; SVG is text (and could carry script), so it is diffed instead. */
export const PREVIEW_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
] as const;

export function isPreviewImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = path.slice(dot + 1).toLowerCase();
  return (PREVIEW_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * The image type of `bytes` by magic number, or null. Both the server (before
 * sending) and the browser (before making a blob URL) check it, so a preview
 * is only ever a raster image, never HTML or SVG.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i] ?? -1;
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => at(offset + i) === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (starts([0x42, 0x4d])) return "image/bmp";
  if (starts([0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  return null;
}
