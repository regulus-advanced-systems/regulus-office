/**
 * The notes of a linked task (#257): each part's henchman leaves notes for the
 * task's owner in `.office/notes.md`; the office collects them, shows them to
 * the owner alone, and writes into a part's `.office/inbox.md` only the notes
 * the owner released (prompt.ts has the file formats).
 *
 * **Nothing crosses rooms by itself.** Everyone who may see a room watches its
 * henchmen's terminals and files (D12), and the people who see one of the
 * task's rooms are not the people who see another (D26, D27). So what a
 * henchman writes in one room is copied into another only when the owner says
 * so, note by note, or for the whole task with automatic release, which is
 * off unless the owner turns it on.
 *
 * **A part whose room its owner can no longer access is left alone**, both
 * ways: its notes are not collected or passed on, and nothing is written to it.
 *
 * **The files are a henchman's.** Its sandbox can replace anything in its
 * worktree, so the office (which is not in the sandbox) treats the paths as
 * hostile:
 * - it touches only worktrees inside their owner's own area (runners/layout.ts);
 * - it opens the worktree and then `.office` without following a link, checks
 *   where each descriptor really points before it creates or opens anything
 *   below it, and reaches the files only through the pinned descriptor;
 * - files are opened without following a link and without blocking, and
 *   anything but a regular file of a sane size is left alone (a FIFO cannot
 *   hold the office up);
 * - it never touches the clone: git is kept away from the directory by a
 *   `.gitignore` inside it;
 * - a round that hangs or fails is given up after a time limit and tried
 *   again on the next one.
 */
import { constants, existsSync } from "node:fs";
import { type FileHandle, mkdir, open, readlink, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  LINKED_INBOX_FILE,
  LINKED_NOTES_DIR,
  LINKED_NOTES_FILE,
  LINKED_PART_NOTES_MAX_CHARS,
} from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import { CLONES_DIR, humanAreaOf } from "../../runners/layout.ts";
import { NOTES_HEADER, newNote, notesBody, renderInbox } from "./prompt.ts";
import type { LinkedTaskStore, PartRow } from "./store.ts";

const name = (path: string) => path.slice(LINKED_NOTES_DIR.length + 1);
const NOTES = name(LINKED_NOTES_FILE);
const INBOX = name(LINKED_INBOX_FILE);
const GITIGNORE = ".gitignore";
/** Keeps git away from the directory, the ignore file included. */
const IGNORE_ALL = "*\n";
/** A notes file larger than this is not read. */
const MAX_FILE_BYTES = LINKED_PART_NOTES_MAX_CHARS * 4 + 4096;
const NOFOLLOW = constants.O_NOFOLLOW | constants.O_NONBLOCK;
const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
/** A round of one task's notes is given up after this long. */
export const NOTES_ROUND_TIMEOUT_MS = 10_000;

const through = (dir: FileHandle, child: string) => `/proc/self/fd/${dir.fd}/${child}`;

/** Open a directory without following a link, and only if it really is `expected`. */
async function pinned(path: string, expected: string): Promise<FileHandle | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, DIRECTORY);
  } catch {
    return null;
  }
  try {
    if ((await readlink(`/proc/self/fd/${handle.fd}`)) === expected) return handle;
  } catch {
    // no /proc: not a platform the office runs henchmen on
  }
  await handle.close();
  return null;
}

/**
 * The worktree's `.office` directory, pinned. The worktree itself is pinned
 * first, so nothing is created or opened below a path that was swapped for a
 * link. Null when it cannot be had safely (or is not there and `create` is off).
 */
export async function openOfficeDir(
  workdir: string,
  area: string,
  create: boolean,
): Promise<FileHandle | null> {
  let real: string;
  try {
    real = join(await realpath(area), relative(area, workdir));
  } catch {
    return null;
  }
  const tree = await pinned(workdir, real);
  if (!tree) return null;
  try {
    const path = through(tree, LINKED_NOTES_DIR);
    if (create) await mkdir(path, { mode: 0o775 }).catch(() => undefined);
    return await pinned(path, join(real, LINKED_NOTES_DIR));
  } finally {
    await tree.close();
  }
}

/** A file in the pinned directory: its text, "" when absent, null when it must be left alone. */
export async function readIn(dir: FileHandle, file: string): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(through(dir, file), constants.O_RDONLY | NOFOLLOW);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "" : null;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return await handle.readFile("utf8");
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Write a file in the pinned directory; false when it could not be written
 * safely. `ifAbsent` only ever creates it: a file that appeared meanwhile (a
 * henchman's first note) is left as it is.
 */
export async function writeIn(
  dir: FileHandle,
  file: string,
  text: string,
  ifAbsent = false,
): Promise<boolean> {
  // Not a regular file (a link, a FIFO, a directory): never opened for writing.
  const current = await readIn(dir, file);
  if (current === null) return false;
  if (current === text) return true;
  let handle: FileHandle;
  try {
    const how = ifAbsent ? constants.O_EXCL : constants.O_TRUNC;
    const flags = constants.O_WRONLY | constants.O_CREAT | how | NOFOLLOW;
    handle = await open(through(dir, file), flags, 0o664);
  } catch {
    return false;
  }
  try {
    if (!(await handle.stat()).isFile()) return false;
    await handle.writeFile(text, "utf8");
    return true;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

export interface NotesDeps {
  store: LinkedTaskStore;
  /** `<worktreesDir>`: files are only touched inside their owner's area under it. */
  worktreesDir: string;
  /** The task's owner may still access this room (operations/access.ts). */
  ownerMayAccess(ownerUserId: string, operationId: string): boolean;
  logger: Logger;
  roundTimeoutMs?: number;
  /** How a worktree's `.office` is opened; the office's own unless given (tests). */
  openOfficeDir?: typeof openOfficeDir;
}

interface Tree {
  part: PartRow;
  workdir: string;
  /** The owner's area the worktree is in: the part of the path henchmen cannot replace. */
  area: string;
}

export class NotesSync {
  readonly #running = new Map<string, Promise<void>>();

  constructor(private readonly deps: NotesDeps) {}

  /** Collect and deliver one task's notes; one round per task at a time, bounded in time. */
  sync(linkedTaskId: string): Promise<void> {
    const pending = this.#running.get(linkedTaskId);
    if (pending) return pending;
    const limit = this.deps.roundTimeoutMs ?? NOTES_ROUND_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), limit);
    });
    const run = Promise.race([this.#sync(linkedTaskId), timeout])
      .catch((err) => {
        this.deps.logger.warn({ linkedTaskId, err: String(err) }, "a round of task notes failed");
      })
      .finally(() => {
        clearTimeout(timer);
        this.#running.delete(linkedTaskId);
      });
    this.#running.set(linkedTaskId, run);
    return run;
  }

  /** Every task with a part at work. */
  async syncActive(): Promise<void> {
    await Promise.all(this.deps.store.idsWithPartIn(["running"]).map((id) => this.sync(id)));
  }

  /** The part's worktree, when the office may keep notes files in it. */
  #tree(part: PartRow): Tree | null {
    const agent = part.agent;
    if (!agent) return null;
    const area = humanAreaOf(agent.workdir, this.deps.worktreesDir, agent.ownerUserId);
    if (!area || !existsSync(agent.workdir)) return null;
    // The owner's clone is not a henchman's own worktree.
    if (relative(area, agent.workdir).split(sep)[0] === CLONES_DIR) return null;
    return { part, workdir: agent.workdir, area };
  }

  async #sync(linkedTaskId: string): Promise<void> {
    const { store } = this.deps;
    const linked = store.get(linkedTaskId);
    if (!linked) return;
    // Parts in rooms the owner can no longer access take no part, either way.
    const open = store
      .parts(linkedTaskId)
      .filter((p) => this.deps.ownerMayAccess(linked.createdBy, p.task.operationId));
    const trees = open.flatMap((p) => this.#tree(p) ?? []);
    for (const tree of trees) {
      await this.#each(tree, (dir) => this.#collect(dir, tree.part, linked.releaseNotes));
    }
    const from = new Set(open.map((p) => p.task.id));
    const released = store.notesOf(linkedTaskId).filter((n) => n.releasedAt && from.has(n.taskId));
    for (const tree of trees) {
      const inbox = renderInbox(
        released.filter((n) => n.taskId !== tree.part.task.id).map((n) => n.body),
      );
      await this.#each(tree, async (dir) => {
        await writeIn(dir, INBOX, inbox);
      });
    }
  }

  /** One part's files; a part that fails does not stop the others. */
  async #each(tree: Tree, fn: (dir: FileHandle) => Promise<void>): Promise<void> {
    let dir: FileHandle | null = null;
    try {
      dir = await (this.deps.openOfficeDir ?? openOfficeDir)(tree.workdir, tree.area, true);
      if (dir) await fn(dir);
    } catch (err) {
      this.deps.logger.debug({ taskId: tree.part.task.id, err: String(err) }, "notes skipped");
    } finally {
      await dir?.close().catch(() => undefined);
    }
  }

  async #collect(dir: FileHandle, part: PartRow, release: boolean): Promise<void> {
    const { store } = this.deps;
    await writeIn(dir, GITIGNORE, IGNORE_ALL);
    const text = await readIn(dir, NOTES);
    if (text === null) return;
    if (text === "") {
      await writeIn(dir, NOTES, NOTES_HEADER, true);
      return;
    }
    const body = notesBody(text);
    const note = newNote(part.task.notesSeen, body);
    if (note === null) return;
    // One part's notes have a size; past it they stay in its file.
    if (store.notesSize(part.task.id) + note.length > LINKED_PART_NOTES_MAX_CHARS) return;
    store.addNote(part.task, note, body, release);
  }

  async idle(): Promise<void> {
    while (this.#running.size > 0) await Promise.all(this.#running.values());
  }
}
