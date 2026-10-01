/**
 * Image drift (#151): after the runner image is rebuilt (new CLI versions),
 * a human's runner keeps running the image it was created from until it is
 * recreated. A stopped runner is recreated when it is started
 * (containers.ts). A running one is recreated on its next use, and only when
 * it is idle: no piped process of this office, no tmux session being created
 * and none alive (agents, login terminals). The tmux check is strict: an
 * answer other than "sessions: …" or "no server" counts as busy, and a busy
 * runner keeps its old image until a later use finds it idle.
 */
import type { RunnerContainer, RunnerContainers } from "./containers.ts";
import type { ExecResult } from "./engine.ts";
import type { PipedTracker } from "./piped-tracker.ts";

/** `tmux list-sessions` without a server: no socket yet, or the server has exited. */
const NO_SERVER = /no server running|error connecting to|no sessions/i;

/** Session names from a `tmux list-sessions` exec, [] for no server, null when unsure. */
export function strictSessions(res: ExecResult | null): string[] | null {
  if (!res) return null;
  if (res.code === 0) return res.stdout.split("\n").filter(Boolean);
  return NO_SERVER.test(res.stderr) ? [] : null;
}

export interface RefreshDeps {
  containers: RunnerContainers;
  piped: PipedTracker;
  /** `tmux list-sessions` in the human's runner (see {@link strictSessions}). */
  listSessions: (userId: string) => Promise<ExecResult | null>;
}

/**
 * `c`, or a new container from the current image when `c` runs an older one
 * and is idle. Runs under the human's mount lock, so no piped process or
 * session starts meanwhile.
 */
export async function refreshIfDrifted(
  deps: RefreshDeps,
  c: RunnerContainer,
): Promise<RunnerContainer> {
  const { containers, piped } = deps;
  if (!c.running || !(await containers.imageChanged(c))) return c;
  return piped.hold(c.userId, async () => {
    const now = await containers.ensure(c.userId);
    if (!now.running || !(await containers.imageChanged(now))) return now;
    const sessions = strictSessions(await deps.listSessions(c.userId).catch(() => null));
    if (sessions === null) return now;
    const busy = await piped.busy(c.userId, async () => sessions, false);
    if (busy.sessions.length > 0 || busy.piped.length > 0) return now;
    return containers.recreate(c.userId, now.operationMounts, "the runner image changed");
  });
}
