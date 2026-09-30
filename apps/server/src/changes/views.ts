/**
 * Read-only views of one changed file (#38): its diff against the base, and
 * the bytes of an image for the preview. Both only serve files git listed in
 * the current look at the worktree, and read working-tree bytes only after
 * `realpath` in the robot's runner shows the path contains no symlink.
 */
import {
  CHANGES_BLOB_MAX_BYTES,
  type ChangedFile,
  type FileDiff,
  type ImageSide,
  isPreviewImagePath,
  sniffImageType,
} from "@regulus/protocol";
import { parseUnifiedDiff } from "./parse.ts";
import { ChangesHttpError, resolvesInside } from "./paths.ts";
import { type RobotShell, text } from "./robot-shell.ts";
import { gitFailure, type WorktreeLook } from "./snapshot.ts";

/** Diffs above this many bytes are not shown line by line. */
export const DIFF_MAX_BYTES = 1024 * 1024;
export const DIFF_MAX_LINES = 5000;

type Entry = ChangedFile & { regular: boolean };

export function entryOf(look: WorktreeLook, path: string): Entry {
  const entry = look.byPath.get(path);
  if (!entry) {
    throw new ChangesHttpError(404, "not_changed", "that file is not among the robot's changes");
  }
  return entry;
}

/** Refuse unless `path` resolves to itself inside the worktree (no symlinked component). */
export async function assertNoSymlink(shell: RobotShell, path: string): Promise<void> {
  const res = await shell.run(["realpath", "-e", "-z", "--", ".", path], { maxBytes: 64 * 1024 });
  if (res.code !== 0 || !resolvesInside(text(res.stdout), path)) {
    throw new ChangesHttpError(
      409,
      "invalid_path",
      "the file is a symlink or lies behind one; it is not shown",
    );
  }
}

function imageSides(look: WorktreeLook, e: Entry): FileDiff["image"] {
  if (!isPreviewImagePath(e.path)) return null;
  const inBase = look.baseSha !== null && e.kind !== "added" && e.kind !== "untracked";
  return { base: inBase, work: e.kind !== "deleted" && !e.symlink };
}

export async function fileDiff(shell: RobotShell, look: WorktreeLook, path: string) {
  const e = entryOf(look, path);
  const out: FileDiff = {
    path: e.path,
    kind: e.kind,
    binary: e.binary,
    symlink: e.symlink,
    tooLarge: false,
    truncated: false,
    hunks: [],
    image: imageSides(look, e),
  };
  if (e.binary) return out;
  let res: Awaited<ReturnType<RobotShell["git"]>>;
  const flags = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "-U3"];
  if (e.kind === "untracked") {
    if (e.symlink || !e.regular) return out;
    await assertNoSymlink(shell, e.path);
    res = await shell.git(["diff", "--no-index", ...flags, "--", "/dev/null", e.path], {
      maxBytes: DIFF_MAX_BYTES,
    });
    // --no-index exits 1 when the files differ.
    if (res.code === 1) res = { ...res, code: 0 };
  } else if (look.baseSha) {
    res = await shell.git(["diff", ...flags, look.baseSha, "--", e.path], {
      maxBytes: DIFF_MAX_BYTES,
    });
  } else {
    return out;
  }
  if (res.truncated) return { ...out, tooLarge: true };
  if (res.code !== 0) throw gitFailure(res, "git diff");
  const parsed = parseUnifiedDiff(text(res.stdout), DIFF_MAX_LINES);
  return {
    ...out,
    binary: out.binary || parsed.binary,
    truncated: parsed.truncated,
    hunks: parsed.hunks,
    image: parsed.binary ? imageSides(look, { ...e, binary: true }) : out.image,
  };
}

export interface ImageBlob {
  bytes: Uint8Array;
  type: string;
}

/** One side of an image for the preview: bytes checked to be a raster image. */
export async function imageBlob(
  shell: RobotShell,
  look: WorktreeLook,
  path: string,
  side: ImageSide,
): Promise<ImageBlob> {
  const e = entryOf(look, path);
  const sides = imageSides(look, e);
  if (!sides) throw new ChangesHttpError(415, "not_image", "not a previewable image");
  if (e.symlink) throw new ChangesHttpError(415, "not_image", "symlinks are not previewed");
  if (!sides[side]) throw new ChangesHttpError(404, "not_changed", `no ${side} version`);
  const cap = { maxBytes: CHANGES_BLOB_MAX_BYTES };
  let res: Awaited<ReturnType<RobotShell["git"]>>;
  if (side === "base") {
    res = await shell.git(["cat-file", "blob", `${look.baseSha}:${e.path}`], cap);
  } else if (e.uncommitted) {
    if (!e.regular) throw new ChangesHttpError(415, "not_image", "not a regular file");
    await assertNoSymlink(shell, e.path);
    res = await shell.run(["head", "-c", String(CHANGES_BLOB_MAX_BYTES + 1), "--", e.path], {
      maxBytes: CHANGES_BLOB_MAX_BYTES,
    });
  } else {
    res = await shell.git(["cat-file", "blob", `HEAD:${e.path}`], cap);
  }
  if (res.truncated) throw new ChangesHttpError(413, "too_large", "the image is too large");
  if (res.code !== 0) throw gitFailure(res, "reading the image");
  const type = sniffImageType(res.stdout);
  if (!type) throw new ChangesHttpError(415, "not_image", "the file is not a supported image");
  return { bytes: res.stdout, type };
}
