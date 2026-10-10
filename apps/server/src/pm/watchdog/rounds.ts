/**
 * The watchdog's round (#253, D30): one implementation, whoever asks for it.
 *
 * The **schedule** (every 60 minutes by default), the **button** in the
 * office and an admin **in chat** all end in `request`. A round has one part
 * for each room with watched targets (parts.ts), and the parts are done one
 * after the other, each in a turn of the office's own:
 *
 * - the turn has a token of its own, so the office knows which part a tool
 *   call belongs to and gives that turn the three round tools and nothing
 *   else (round-tools.ts, tools/call.ts);
 * - in it the office reads only that part's targets (check.ts), so no turn
 *   ever holds two rooms' data, whatever a log line or a Sentry event says.
 *
 * A part that does not finish (the model stopped early, the engine failed,
 * the office restarted, the time ran out) is marked failed with why, and what
 * it read is not kept as read: the next round reads the same lines again.
 * Findings it had recorded before it failed stand, and people are told of
 * them all the same. A failed round is tried again on the next tick, once.
 *
 * Each part's turn has a turn token of the office's (runtime.ts `instruct`:
 * #301's per-turn tokens, bound to the part in place of a person). After an
 * office restart those tokens are all revoked and `boot` fails the round that
 * was under way. A watchdog a person stopped is not started by the schedule,
 * nor for the rest of a round it was stopped in.
 */
import type { WatchdogRoundTrigger } from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import { EngineRefusal } from "../engines/types.ts";
import type { InstructionResult } from "../instructions.ts";
import type { OfficeAgentRow } from "../store.ts";
import type { FindingRow, FindingStore } from "./findings.ts";
import type { WatchdogFixes } from "./fix.ts";
import type { PartRow, RoundRow, RoundStore } from "./parts.ts";
import type { SentryNotes } from "./sentry-notes.ts";
import type { WatchdogStore } from "./store.ts";

/** A part's turn may take this long (the CLI session engine gives a turn ten minutes). */
export const PART_TIMEOUT_MS = 12 * 60_000;
export const PART_KEY = "watchdog-part:";
const STOPPED = "the watchdog was stopped by a person";

/** Findings with a verdict that people were not told of yet. */
export interface WatchdogRoundReport {
  agentName: string;
  /** The round that gave most of them their verdict, for a link. */
  roundId: string;
  /** New findings and ones that are back, of every disposition but `dismiss`. */
  findings: FindingRow[];
}

/**
 * Where findings are told. The office UI is one reporter (setup.ts); the
 * office PM's Discord channel (#258) is to be another. A reporter gets every
 * finding and must itself tell each one only to people who may see its room
 * (`finding.scope`, `finding.operationId`; D26, D27). It is called only when
 * there is something to tell: a round with nothing new shows in the office UI
 * and nowhere else.
 */
export interface WatchdogReporter {
  roundEnded(report: WatchdogRoundReport): void | Promise<void>;
}

export interface WatchdogRoundsDeps {
  store: WatchdogStore;
  findings: FindingStore;
  parts: RoundStore;
  agents: { get(id: string): OfficeAgentRow | undefined };
  runtime: {
    instruct(row: OfficeAgentRow, key: string, fromName: string, text: string): Promise<void>;
    endInstruction(agentId: string, key: string): void;
  };
  fixes: WatchdogFixes;
  notes: SentryNotes;
  logger: Logger;
  now: () => number;
}

/** A round cannot be started; the message is safe to show. */
export class RoundRefusal extends Error {
  override name = "RoundRefusal";
  constructor(
    readonly code: "not_configured" | "conflict" | "agent_unavailable",
    message: string,
  ) {
    super(message);
  }
}

export class WatchdogRounds {
  readonly #reporters: WatchdogReporter[] = [];
  #ticking = false;

  constructor(private readonly deps: WatchdogRoundsDeps) {}

  addReporter(reporter: WatchdogReporter): void {
    this.#reporters.push(reporter);
  }

  /**
   * The office's watchdog as it is now, or undefined when none is chosen or
   * it is not fit: a shared agent, with the watchdog job, on the engine that
   * honours a turn of the office's own with its own token.
   */
  agent(): OfficeAgentRow | undefined {
    const id = this.deps.store.settings().agentId;
    const row = id ? this.deps.agents.get(id) : undefined;
    return row && fitToWatch(row) ? row : undefined;
  }

  /** Sentry can be read: an organisation, a token and at least one project. */
  sentryReady(): boolean {
    const { store } = this.deps;
    const settings = store.settings();
    return (
      settings.sentryOrganization !== "" &&
      settings.encryptedSentryToken !== null &&
      store.sentryProjects().length > 0
    );
  }

  hasTargets(): boolean {
    return this.sentryReady() || this.deps.store.apps().length > 0;
  }

  /** When the schedule asks for the next round; undefined while it is off or nothing is set. */
  nextRoundAt(): number | undefined {
    const settings = this.deps.store.settings();
    const agent = this.agent();
    if (!settings.enabled || !agent || !this.hasTargets()) return undefined;
    // A person stopped the watchdog (#301): the schedule does not start it behind their back.
    if (agent.stoppedByPerson) return undefined;
    const last = settings.lastRoundAt?.getTime();
    if (last === undefined) return this.deps.now();
    // A round that failed is tried again at once; one that failed twice waits its turn.
    const [newest, before] = this.deps.parts.rounds(2);
    if (newest?.state === "failed" && before?.state !== "failed") {
      return newest.finishedAt?.getTime() ?? this.deps.now();
    }
    return last + settings.intervalMinutes * 60_000;
  }

  // ---- Asking for a round ----------------------------------------------------------

  /** After a restart no turn survived: a round that was under way did not finish. */
  boot(): void {
    const open = this.deps.parts.openRound();
    if (open) this.deps.parts.failRound(open.id, "the office restarted during the round");
    void this.announce();
  }

  /**
   * The schedule, a person at the button or an admin in chat asks for a round.
   * Throws {@link RoundRefusal}.
   */
  async request(trigger: WatchdogRoundTrigger, by: string | null): Promise<RoundRow> {
    const { parts, store } = this.deps;
    const chosen = this.agent();
    if (!chosen) {
      throw new RoundRefusal("not_configured", "no watchdog that can do rounds is chosen");
    }
    // Only a person starts an agent a person stopped: asking for a round is that; the clock is not.
    if (trigger === "schedule" && chosen.stoppedByPerson) {
      throw new RoundRefusal("not_configured", STOPPED);
    }
    if (!this.hasTargets()) throw new RoundRefusal("not_configured", "nothing is set to watch");
    if (parts.openRound()) throw new RoundRefusal("conflict", "a round is already under way");
    const round = parts.create(trigger, by, store.groups(this.sentryReady()));
    store.markRound();
    const refused = await this.#advance(round.id, trigger !== "schedule");
    if (refused) throw new RoundRefusal("agent_unavailable", refused);
    return parts.round(round.id) as RoundRow;
  }

  /**
   * Give the next pending part its turn, or close the round when none is
   * left. Returns why when the watchdog cannot be reached: the round is then
   * failed whole. `asked`: a person asked for this round just now, which is a
   * person starting the watchdog; the parts after the first are not.
   */
  async #advance(roundId: string, asked = false): Promise<string | null> {
    const { parts, runtime, notes } = this.deps;
    const next = parts.parts(roundId).find((p) => p.state === "pending");
    if (!next) {
      if (parts.closeRound(roundId)) {
        notes.retryFailed();
        void notes.flush();
      }
      return null;
    }
    const agent = this.agent();
    const round = parts.round(roundId);
    if (!agent || !round) {
      parts.failRound(roundId, "the watchdog is no longer chosen");
      return "the watchdog is no longer chosen";
    }
    // A person stopped it (#301), perhaps in the middle of this round: the office does not
    // start it again for the parts that are left.
    if (agent.stoppedByPerson && !asked) {
      parts.failRound(roundId, STOPPED);
      return STOPPED;
    }
    // One part at a time, handed out once: the end of the part before and a tick may both be
    // here, and whoever comes second finds a part running or this one taken.
    if (parts.runningPart() || !parts.startPart(next.id)) return null;
    try {
      await runtime.instruct(
        agent,
        `${PART_KEY}${next.id}`,
        round.trigger === "schedule"
          ? "the office's schedule"
          : "the office, because a person asked",
        "Do this part of your round now: call watchdog_check, judge what it returns, and finish with watchdog_finish_round.",
      );
      return null;
    } catch (err) {
      const why = err instanceof EngineRefusal ? err.message : "the watchdog could not be reached";
      parts.failRound(roundId, why);
      return why;
    }
  }

  /** A part's turn is over, however it ended: tell what it found, and go on. */
  async #partEnded(part: PartRow): Promise<void> {
    await this.announce();
    await this.#advance(part.roundId);
  }

  /** The turn the office gave the watchdog for a part has ended. */
  instructed(result: InstructionResult): void {
    if (!result.key.startsWith(PART_KEY)) return;
    const part = this.deps.parts.part(result.key.slice(PART_KEY.length));
    if (!part) return;
    // A part that was finished is closed already, and this changes nothing.
    this.deps.parts.failPart(
      part.id,
      result.ok
        ? "the watchdog ended its turn without finishing"
        : `the watchdog could not do it: ${result.text}`,
    );
    void this.#partEnded(part).catch((err) =>
      this.deps.logger.error({ err: String(err).slice(0, 200) }, "watchdog round did not go on"),
    );
  }

  /** Once a minute: time out a stuck part, start a due round, follow the fixes and the comments. */
  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    const { parts, fixes, notes, logger, now, runtime } = this.deps;
    try {
      const running = parts.runningPart();
      if (running && now() - (running.startedAt?.getTime() ?? 0) > PART_TIMEOUT_MS) {
        const agent = this.agent();
        // Its token stops working: a turn that is still going can record nothing more.
        if (agent) runtime.endInstruction(agent.id, `${PART_KEY}${running.id}`);
        parts.failPart(running.id, "it did not finish in time");
        await this.#partEnded(running);
      }
      // An open round in which nothing runs (its hand-over was lost): it goes on, or is closed.
      const open = parts.openRound();
      if (open && !parts.runningPart()) await this.#advance(open.id);
      const due = this.nextRoundAt();
      if (due !== undefined && due <= now() && !parts.openRound()) {
        await this.request("schedule", null).catch((err) => {
          if (!(err instanceof RoundRefusal)) throw err;
        });
      }
      await fixes.tick();
      await notes.flush();
    } catch (err) {
      logger.error({ err: String(err).slice(0, 300) }, "watchdog tick failed");
    } finally {
      this.#ticking = false;
    }
  }

  /**
   * Tell the people concerned of every finding whose verdict they were not
   * told of yet: after a part that finished, and after one that failed.
   */
  async announce(): Promise<void> {
    const { findings, logger } = this.deps;
    const fresh = findings.unannounced();
    if (fresh.length === 0) return;
    // Marked first: a reporter that fails must not make the others tell twice.
    findings.announced(fresh.map((f) => f.id));
    const report: WatchdogRoundReport = {
      agentName: this.agent()?.name ?? "The watchdog",
      roundId: fresh[0]?.roundId ?? "",
      findings: fresh,
    };
    for (const reporter of this.#reporters) {
      try {
        await reporter.roundEnded(report);
      } catch (err) {
        logger.error({ err: String(err).slice(0, 200) }, "watchdog reporter failed");
      }
    }
  }
}

/** Can this agent be the office's watchdog? */
export function fitToWatch(row: Pick<OfficeAgentRow, "ownerUserId" | "role" | "engine">): boolean {
  // Only the CLI session engine honours a turn of the office's own with its own token.
  return row.ownerUserId === null && row.role === "watchdog" && row.engine === "cli-session";
}
