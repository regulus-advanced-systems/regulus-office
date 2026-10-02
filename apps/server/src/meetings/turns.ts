/**
 * Waiting for henchmen (#50): until a member is ready for its first turn, and
 * until a prompted turn is over. Status changes come from the AgentManager's
 * observer (`statusChanged`); a poll covers what an event cannot say (the
 * notes file is there, a status that was already reached before we looked).
 *
 * A turn is over when the henchman went busy after the prompt and came back
 * to `idle`, `done` or `waiting_input`, or when the poll says so (its notes
 * are written and it is not busy). `waiting_permission` keeps the turn open:
 * the starter approves in the henchman's own panel as usual. `error`,
 * `exited` and `offline` end the turn as failed.
 */
import type { AgentStatus } from "@regulus/protocol";

export const BUSY: readonly AgentStatus[] = ["working", "waiting_permission"];
export const RESTING: readonly AgentStatus[] = ["idle", "done", "waiting_input"];
export const GONE: readonly AgentStatus[] = ["error", "exited", "offline"];

export class TurnError extends Error {
  override name = "TurnError";
}

export class MeetingAborted extends Error {
  override name = "MeetingAborted";
}

type Verdict = "resolve" | "reject" | undefined;

interface Waiter {
  onStatus(status: AgentStatus): void;
}

export interface WaitOptions {
  signal: AbortSignal;
  timeoutMs: number;
  pollMs: number;
  timeoutMessage: string;
  onStatus(status: AgentStatus): Verdict;
  /** Checked every `pollMs` (and once at once). */
  poll(): Promise<Verdict> | Verdict;
}

export class TurnWatch {
  readonly #waiters = new Map<string, Set<Waiter>>();

  /** Feed a henchman's status change (from the AgentManager's observer). */
  statusChanged(agentId: string, status: AgentStatus): void {
    for (const w of [...(this.#waiters.get(agentId) ?? [])]) w.onStatus(status);
  }

  until(agentId: string, opts: WaitOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let polling = false;
      const set = this.#waiters.get(agentId) ?? new Set<Waiter>();
      this.#waiters.set(agentId, set);
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(ticker);
        opts.signal.removeEventListener("abort", onAbort);
        set.delete(waiter);
        if (set.size === 0) this.#waiters.delete(agentId);
        if (err) reject(err);
        else resolve();
      };
      const apply = (verdict: Verdict, why: string) => {
        if (verdict === "resolve") finish();
        else if (verdict === "reject") finish(new TurnError(why));
      };
      const waiter: Waiter = {
        onStatus: (status) => apply(opts.onStatus(status), `the henchman is ${status}`),
      };
      const onAbort = () => finish(new MeetingAborted("the meeting was interrupted"));
      const tick = async () => {
        if (settled || polling) return;
        polling = true;
        try {
          apply(await opts.poll(), "the henchman is not available");
        } catch {
          // A failed poll (runner busy) is retried on the next tick.
        } finally {
          polling = false;
        }
      };
      set.add(waiter);
      const timer = setTimeout(() => finish(new TurnError(opts.timeoutMessage)), opts.timeoutMs);
      const ticker = setInterval(() => void tick(), opts.pollMs);
      if (opts.signal.aborted) return onAbort();
      opts.signal.addEventListener("abort", onAbort);
      void tick();
    });
  }
}

/** Ready for a prompt: started up and resting. */
export function readyVerdict(status: AgentStatus | undefined): Verdict {
  if (status === undefined) return "reject";
  if (RESTING.includes(status)) return "resolve";
  if (GONE.includes(status)) return "reject";
  return undefined;
}

/**
 * The verdicts of one turn. `sawBusy` flips once the henchman went busy after
 * the prompt. The poll resolves when it rests with notes written, and those
 * notes are new: either it went busy since the prompt, or the file differs
 * from `stale` (what was there before the prompt, from an earlier attempt).
 */
export function turnVerdicts(opts: { busy: boolean; stale: string | null }) {
  let sawBusy = opts.busy;
  return {
    onStatus(status: AgentStatus): Verdict {
      if (BUSY.includes(status)) {
        sawBusy = true;
        return undefined;
      }
      if (GONE.includes(status)) return "reject";
      return RESTING.includes(status) && sawBusy ? "resolve" : undefined;
    },
    poll(status: AgentStatus | undefined, notes: string | null): Verdict {
      if (status === undefined || GONE.includes(status)) return "reject";
      if (notes === null || !RESTING.includes(status)) return undefined;
      return sawBusy || notes !== opts.stale ? "resolve" : undefined;
    },
  };
}
