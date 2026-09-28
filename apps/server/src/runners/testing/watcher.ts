/**
 * Test helper: attach a read-only terminal watcher to a session the way the
 * terminal bridge does (`runner.attach(session, "watch")` through a Bun PTY or
 * the backend's TTY stream), so runner tests can check that input still gets
 * through while someone watches (#107).
 */
import { openPipe } from "../../terminals/pipe.ts";
import type { Runner, TmuxSessionRef } from "../types.ts";

export interface Watcher {
  /** Everything the watcher's terminal received so far. */
  output(): string;
  close(): Promise<void>;
}

/** Attach and wait until the watcher's terminal shows `expect` (tmux redraws on attach). */
export async function attachWatcher(
  runner: Runner,
  session: TmuxSessionRef,
  expect: string,
  ms = 10_000,
): Promise<Watcher> {
  let seen = "";
  const decoder = new TextDecoder();
  const pipe = await openPipe(runner.attach(session, "watch"), { cols: 120, rows: 40 }, (bytes) => {
    seen += decoder.decode(bytes, { stream: true });
  });
  const watcher: Watcher = {
    output: () => seen,
    async close() {
      pipe.close();
      await pipe.closed;
    },
  };
  const deadline = Date.now() + ms;
  while (!seen.includes(expect)) {
    if (Date.now() > deadline) {
      await watcher.close();
      throw new Error(
        `watcher did not show ${JSON.stringify(expect)}; got ${JSON.stringify(seen)}`,
      );
    }
    await Bun.sleep(25);
  }
  return watcher;
}
