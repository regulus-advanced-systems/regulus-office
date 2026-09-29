/**
 * Piped side processes (`spawnPiped`: login checks, `codex app-server`) live
 * in each human's runner, and the per-human lock around mount changes.
 *
 * A container recreate (mounts.ts) kills everything in the runner. tmux
 * sessions are agents and login terminals that live for minutes or hours, so a
 * recreate never waits for them. A piped status check lasts a second or two,
 * so `mountProject` waits a short, bounded time for piped processes to finish
 * before it recreates, and names the ones that did not in `RunnerBusyError`
 * (#126: the spawn dialog's `claude auth status` used to fail the first spawn
 * on a floor).
 *
 * While a mount change is in progress ({@link PipedTracker.hold}), new piped
 * processes wait for it and then start in the new container, instead of
 * starting in the old one and being killed by the recreate.
 */
import { posix } from "node:path";

/** How long a recreate waits for piped processes by default. */
export const DEFAULT_PIPED_DRAIN_MS = 5_000;

const WORD = /^[a-z][a-z0-9-]{0,23}$/;

/** `claude auth status`, `codex app-server`: program basename plus up to two subcommand words. */
export function pipedLabel(argv: readonly string[]): string {
  const [bin = "?", ...rest] = argv;
  const words: string[] = [];
  for (const arg of rest) {
    if (words.length === 2 || !WORD.test(arg)) break;
    words.push(arg);
  }
  return [posix.basename(bin), ...words].join(" ");
}

export class PipedTracker {
  readonly #live = new Map<string, Map<Promise<unknown>, string>>();
  readonly #holds = new Map<string, Promise<unknown>>();

  /** `drainMs`: how long {@link drain} waits at most. */
  constructor(readonly drainMs = DEFAULT_PIPED_DRAIN_MS) {}

  /**
   * Run `work` (a mount change) with the human's lock: after any earlier
   * holder, and with new piped processes waiting until it is done.
   */
  hold<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.#holds.get(userId) ?? Promise.resolve()).catch(() => {}).then(work);
    this.#holds.set(userId, run);
    const release = () => {
      if (this.#holds.get(userId) === run) this.#holds.delete(userId);
    };
    run.then(release, release);
    return run;
  }

  /**
   * Start a piped process with `start` and count it as live until it exits.
   * It counts from this call on (provisioning included), or, during a hold,
   * from when the hold ends.
   */
  track<P extends { exited: Promise<unknown> }>(
    userId: string,
    argv: readonly string[],
    start: () => Promise<P>,
  ): Promise<P> {
    const begin = () => {
      const proc = start();
      this.#add(
        userId,
        pipedLabel(argv),
        proc.then((p) => p.exited),
      );
      return proc;
    };
    const held = this.#holds.get(userId);
    return held ? held.catch(() => {}).then(begin) : begin();
  }

  /** Labels of the human's live piped processes. */
  labels(userId: string): string[] {
    return [...(this.#live.get(userId)?.values() ?? [])];
  }

  /**
   * What keeps a recreate from happening now. Sessions refuse at once; with
   * `wait`, piped processes get up to `drainMs` to finish first (and sessions
   * are listed again after waiting, in case one started meanwhile).
   */
  async busy(
    userId: string,
    listSessions: () => Promise<string[]>,
    wait: boolean,
  ): Promise<{ sessions: string[]; piped: string[] }> {
    const sessions = await listSessions();
    if (!wait || sessions.length > 0 || this.labels(userId).length === 0) {
      return { sessions, piped: this.labels(userId) };
    }
    const piped = await this.drain(userId);
    return { sessions: await listSessions(), piped };
  }

  /**
   * Wait until the human has no live piped processes, or `ms` passed.
   * Returns what is still running (empty when drained).
   */
  async drain(userId: string, ms = this.drainMs): Promise<string[]> {
    const deadline = Date.now() + ms;
    for (;;) {
      const live = this.#live.get(userId);
      const left = deadline - Date.now();
      if (!live || live.size === 0 || left <= 0) return this.labels(userId);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...live.keys()]),
        new Promise((r) => {
          timer = setTimeout(r, left);
        }),
      ]);
      clearTimeout(timer);
    }
  }

  #add(userId: string, label: string, exited: Promise<unknown>): void {
    const live = this.#live.get(userId) ?? new Map<Promise<unknown>, string>();
    this.#live.set(userId, live);
    live.set(exited, label);
    exited
      .finally(() => {
        live.delete(exited);
        if (live.size === 0 && this.#live.get(userId) === live) this.#live.delete(userId);
      })
      .catch(() => {});
  }
}
