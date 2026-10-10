/**
 * The watchdog's tools, as the office does them (#253, D30).
 *
 * The three round tools work for the part of a round the calling turn was
 * given for, which the office knows from the turn's own token (`turn`, the
 * key the office gave that turn), never from anything the model says. A
 * conversation has no such token, so nothing of a round can be read or
 * written from a conversation.
 *
 * The two conversation tools act for a person who is waiting for the
 * watchdog's answer: their own report, and a round if they may ask for one.
 */
import type { WatchdogFindingInput, WatchdogFinishInput } from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import { isOfficeManager, type OperationActor } from "../../operations/access.ts";
import type { AgentPerson } from "../access.ts";
import type { OfficeAgentRow } from "../store.ts";
import { ToolError, type WatchdogToolPort } from "../tools/context.ts";
import { type CheckDeps, readPart } from "./check.ts";
import { scrubEvidence } from "./evidence.ts";
import type { FindingStore } from "./findings.ts";
import { roomHasRepo, type WatchdogFixes } from "./fix.ts";
import type { PartRow, RoundStore } from "./parts.ts";
import { PART_KEY, RoundRefusal, type WatchdogRounds } from "./rounds.ts";
import { cite, signalView, storedKey } from "./signals.ts";
import type { WatchdogStore } from "./store.ts";

export interface RoundToolsDeps {
  store: WatchdogStore;
  findings: FindingStore;
  parts: RoundStore;
  rounds: WatchdogRounds;
  fixes: WatchdogFixes;
  check: CheckDeps;
  /** The report as a person may see it, and the rooms it tells of (service.ts). */
  report: (person: OperationActor) => { report: unknown; rooms: string[] };
}

const ELSEWHERE =
  "It runs in turns of the office's own, not in this conversation, and its report shows in the office under Settings, Watchdog, to each person within what they may see. When it has ended you can read the person their report with watchdog_read_report.";

export class RoundTools implements WatchdogToolPort {
  /** Parts whose targets are being read right now. */
  readonly #reading = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: RoundToolsDeps) {}

  #assert(agent: OfficeAgentRow): void {
    if (this.deps.rounds.agent()?.id !== agent.id) {
      throw new ToolError("forbidden", "you are not the office's watchdog");
    }
  }

  /** The part this turn was given for, while it is under way. */
  #part(agent: OfficeAgentRow, turn: string): PartRow {
    this.#assert(agent);
    const part = turn.startsWith(PART_KEY)
      ? this.deps.parts.part(turn.slice(PART_KEY.length))
      : undefined;
    if (!part || part.state !== "running") {
      throw new ToolError("invalid_input", "this part of the round is over");
    }
    return part;
  }

  async check(agent: OfficeAgentRow, turn: string): Promise<unknown> {
    const first = this.#part(agent, turn);
    // One reading per part: a second call while the first reads waits for it and is handed
    // the same signals, so it neither removes the key folder under it nor overwrites its marks.
    const going = this.#reading.get(first.id);
    if (going) await going.catch(() => {});
    const part = going ? this.#part(agent, turn) : first;
    const { parts, findings } = this.deps;
    const steps =
      "Record a finding for each signal that is new or back (several signals of one fault go into one finding), then call watchdog_finish_round.";
    if (part.checkedAt !== null) {
      // Read once per part: asked again, the same signals are handed back.
      const known = (key: string) =>
        findings.known([storedKey(key, part.operationId)]).get(storedKey(key, part.operationId));
      return {
        signals: Object.values(parts.signals(part)).map((signal) => {
          const before = known(signal.key);
          return signalView(
            signal,
            before ? { title: before.title, disposition: before.disposition } : undefined,
          );
        }),
        notRead: part.error ? part.error.split("\n") : [],
        steps,
      };
    }
    const since = parts
      .rounds(20)
      .find((r) => r.state === "done")
      ?.startedAt.getTime();
    const run = readPart(this.deps.check, part, agent.id, since);
    this.#reading.set(part.id, run);
    try {
      const reading = await run;
      parts.noteCheck(part.id, reading);
      return { signals: reading.view, notRead: reading.unreachable, steps };
    } finally {
      this.#reading.delete(part.id);
    }
  }

  async recordFinding(
    agent: OfficeAgentRow,
    turn: string,
    input: WatchdogFindingInput,
  ): Promise<unknown> {
    const part = this.#part(agent, turn);
    const { store, findings, parts, fixes } = this.deps;
    if (part.checkedAt === null) {
      throw new ToolError("invalid_input", "call watchdog_check first");
    }
    // Which fault, where it belongs, whether it is back and the evidence: the office's.
    const cited = cite(parts.signals(part), part.operationId, input.sources);
    const proposes = input.disposition === "propose_fix";
    const room = part.operationId;
    // The watchdog's own words are scrubbed like any text that came near a log.
    const recorded = findings.record({
      roundId: part.roundId,
      title: scrubEvidence(input.title),
      evidence: cited.evidence,
      disposition: input.disposition,
      reason: scrubEvidence(input.reason),
      scope: part.scope,
      operationId: room,
      sources: cited.sources,
      fixState: !proposes
        ? "none"
        : room !== null && roomHasRepo(store.db, room)
          ? "awaiting_approval"
          : "unavailable",
      fixSummary: proposes ? scrubEvidence(input.fix ?? "") : "",
      sentryComment:
        cited.sentry && store.settings().encryptedSentryToken !== null ? "pending" : "none",
    });
    if (recorded.status === "already_recorded") {
      return {
        findingId: recorded.finding.id,
        status: "already_recorded",
        disposition: recorded.finding.disposition,
        note: "This fault was judged before; its verdict stands and nobody is told again.",
      };
    }
    // `auto` (D30): the fix is handed on unasked, within its caps; in `ask` it waits for a person.
    if (recorded.finding.fixState === "awaiting_approval") {
      fixes.auto(recorded.finding, part.roundId);
    }
    const after = findings.finding(recorded.finding.id) ?? recorded.finding;
    return {
      findingId: after.id,
      status: recorded.status,
      disposition: after.disposition,
      ...(proposes ? { fix: after.fixState } : {}),
    };
  }

  async finish(agent: OfficeAgentRow, turn: string, input: WatchdogFinishInput): Promise<unknown> {
    const part = this.#part(agent, turn);
    const { store, findings, parts, rounds } = this.deps;
    if (part.checkedAt === null) {
      throw new ToolError("invalid_input", "call watchdog_check first");
    }
    if (!parts.finishPart(part.id, scrubEvidence(input.summary))) {
      throw new ToolError("invalid_input", "this part of the round is over");
    }
    // Only now is what the part read "read": a part that fails is read again.
    store.saveMarks(parts.marks(part));
    // Sentry projects of this part that were read whole: their window moves on.
    const truncated = new Set(parts.truncated(part));
    store.setUnread(
      store
        .sentryProjects()
        .filter((p) => p.operationId === part.operationId && !truncated.has(p.id))
        .map((p) => p.id),
      null,
    );
    const mine = findings.ofRound(part.roundId).filter((f) => f.operationId === part.operationId);
    await rounds.announce();
    return { ok: true, findings: mine.length };
  }

  async requestRound(agent: OfficeAgentRow, person: AgentPerson): Promise<unknown> {
    this.#assert(agent);
    const { store, rounds } = this.deps;
    // A round spends the office's key and reads every watched room: for who may set it up.
    if (!isOfficeManager(person.role)) {
      throw new ToolError(
        "forbidden",
        "only office owners and admins can ask for a round; anyone can read their own report",
      );
    }
    if (!store.settings().enabled) {
      return { started: false, note: "No round was started: the watchdog is switched off." };
    }
    try {
      const round = await rounds.request("chat", person.id);
      writeAudit(store.db, {
        userId: person.id,
        action: AUDIT_ACTIONS.watchdogRoundRequest,
        targetKind: "watchdog",
        targetId: round.id,
        meta: { via: "chat" },
      });
    } catch (err) {
      if (!(err instanceof RoundRefusal)) throw err;
      return { started: false, note: `No round was started: ${err.message}. ${ELSEWHERE}` };
    }
    return { started: true, note: `A round was started. ${ELSEWHERE}` };
  }

  readReport(agent: OfficeAgentRow, person: AgentPerson) {
    this.#assert(agent);
    return this.deps.report({ id: person.id, role: person.role });
  }
}
