/**
 * The watchdog's report and what people decide about a finding (#253, D30).
 *
 * Everyone reads the report, each within what they may see **now** (D26,
 * D27), decided at each request:
 * - a finding of a room: people whose own GitHub access opens that room;
 * - a finding of a target without a room: office owners and admins;
 * - the watchdog's own words about a part of a round (its summary, and what
 *   it could not read) belong to that part's room and follow the same rule.
 *   A part reads one room only, so a summary cannot tell of another room,
 *   and a room that is gone or closed to the viewer shows nothing of it,
 *   whatever the targets are today.
 *
 * A person is told of a finding once, when they are connected (told.ts):
 * `tell` is the count for the push or for a client that asks at connect.
 *
 * A fix is decided by a person who may queue work in the finding's room.
 * Marking a finding as known noise is for the same people (owners and
 * admins for a target without a room): it is a person's standing decision,
 * kept on the finding, not something the watchdog remembers.
 */
import {
  mayQueueTask,
  WATCHDOG_LIMITS,
  type WatchdogFindingView,
  type WatchdogNews,
  type WatchdogReport,
  type WatchdogRoundView,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, type AuditAction, writeAudit } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import {
  isOfficeManager,
  type OperationActor,
  operationAccessFor,
} from "../../operations/access.ts";
import { WatchdogError } from "./errors.ts";
import type { FindingRow, FindingStore, SourceRow } from "./findings.ts";
import { FixError, type WatchdogFixes } from "./fix.ts";
import type { PartRow, RoundRow, RoundStore } from "./parts.ts";
import { RoundRefusal, type WatchdogRounds } from "./rounds.ts";
import type { WatchdogStore } from "./store.ts";
import { TOLD_WINDOW_MS, type ToldStore } from "./told.ts";

export interface WatchdogServiceDeps {
  db: Db;
  store: WatchdogStore;
  findings: FindingStore;
  parts: RoundStore;
  rounds: WatchdogRounds;
  fixes: WatchdogFixes;
  told: ToldStore;
  now: () => number;
}

interface Scoped {
  scope: "room" | "office";
  operationId: string | null;
}

export class WatchdogService {
  constructor(private readonly deps: WatchdogServiceDeps) {}

  /**
   * May this person see what belongs to this room (a finding, a part of a
   * round)? What belonged to a room that is gone shows to nobody.
   */
  maySee(actor: OperationActor, what: Scoped): boolean {
    if (what.scope === "office") return isOfficeManager(actor.role);
    return (
      what.operationId !== null &&
      operationAccessFor(this.deps.db, actor, what.operationId) !== null
    );
  }

  /** May this person decide about a finding: queue its fix, mark it as noise? */
  #mayDecide(actor: OperationActor, finding: FindingRow): boolean {
    if (finding.scope === "office") return isOfficeManager(actor.role);
    if (finding.operationId === null) return false;
    return mayQueueTask(operationAccessFor(this.deps.db, actor, finding.operationId));
  }

  #audit(actor: OperationActor, action: AuditAction, targetId: string | null, meta = {}): void {
    writeAudit(this.deps.db, {
      userId: actor.id,
      action,
      targetKind: "watchdog",
      targetId,
      meta,
    });
  }

  #findingView(
    actor: OperationActor,
    finding: FindingRow,
    sources: readonly SourceRow[],
  ): WatchdogFindingView {
    const decide = this.#mayDecide(actor, finding);
    return {
      id: finding.id,
      title: finding.title,
      evidence: finding.evidence,
      disposition: finding.noiseBy ? "dismiss" : finding.disposition,
      reason: finding.reason,
      operationId: finding.operationId,
      sources: sources
        .filter((s) => s.findingId === finding.id)
        .map((s) => ({ kind: s.kind, label: s.label, ...(s.url ? { url: s.url } : {}) })),
      firstSeenAt: finding.firstSeenAt.getTime(),
      lastSeenAt: finding.lastSeenAt.getTime(),
      seenCount: finding.seenCount,
      regressions: finding.regressions,
      noise: finding.noiseBy !== null,
      canMarkNoise: decide,
      fix: {
        state: finding.fixState,
        summary: finding.fixSummary,
        auto: finding.fixAuto,
        ...(finding.fixPrNumber ? { prNumber: finding.fixPrNumber } : {}),
        ...(finding.fixPrUrl ? { prUrl: finding.fixPrUrl } : {}),
        ...(finding.fixError ? { error: finding.fixError } : {}),
        // Only a room finding has a repo to fix.
        canDecide: finding.fixState === "awaiting_approval" && finding.scope === "room" && decide,
      },
      sentryComment: finding.sentryComment,
    };
  }

  #roundView(
    actor: OperationActor,
    round: RoundRow,
    parts: readonly PartRow[],
    visible: readonly FindingRow[],
  ): WatchdogRoundView {
    const summaries: string[] = [];
    for (const part of parts) {
      if (part.roundId !== round.id || !this.maySee(actor, part)) continue;
      if (part.summary) summaries.push(part.summary);
      // What a finished part could not read (a failed part's `error` is why it failed).
      if (part.state === "done" && part.error) {
        summaries.push(...part.error.split("\n").map((line) => `Not read: ${line}`));
      }
    }
    return {
      id: round.id,
      trigger: round.trigger,
      state: round.state,
      startedAt: round.startedAt.getTime(),
      ...(round.finishedAt ? { finishedAt: round.finishedAt.getTime() } : {}),
      findingIds: visible.filter((f) => f.roundId === round.id).map((f) => f.id),
      summaries,
      ...(round.error ? { error: round.error } : {}),
    };
  }

  report(actor: OperationActor): WatchdogReport {
    const { store, findings, parts, rounds } = this.deps;
    const settings = store.settings();
    const agent = rounds.agent();
    const visible = findings
      .findings(WATCHDOG_LIMITS.findingsPage)
      .filter((f) => this.maySee(actor, f));
    const sources = findings.sources(visible.map((f) => f.id));
    const list = parts.rounds(WATCHDOG_LIMITS.roundsPage);
    const allParts = parts.partsOf(list.map((r) => r.id));
    const next = rounds.nextRoundAt();
    const manager = isOfficeManager(actor.role);
    return {
      configured: agent !== undefined && rounds.hasTargets(),
      enabled: settings.enabled,
      agent: agent
        ? {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            stoppedByPerson: agent.stoppedByPerson,
          }
        : null,
      running: parts.openRound() !== undefined,
      ...(next === undefined ? {} : { nextRoundAt: next }),
      rounds: list.map((r) => this.#roundView(actor, r, allParts, visible)),
      findings: visible.map((f) => this.#findingView(actor, f, sources)),
      canRunNow: manager,
      canConfigure: manager,
    };
  }

  /**
   * The report in short, for the watchdog to read to the person who asked, and
   * the rooms it tells of: from then on they are in that conversation (#301).
   */
  reportFor(actor: OperationActor) {
    const report = this.report(actor);
    const lastRounds = report.rounds.slice(0, 5);
    const findings = report.findings.slice(0, 20);
    const rooms = new Set<string>();
    for (const finding of findings) if (finding.operationId) rooms.add(finding.operationId);
    // A round's summaries are its parts' words about their rooms.
    for (const part of this.deps.parts.partsOf(lastRounds.map((r) => r.id))) {
      if (part.operationId && (part.summary || part.error) && this.maySee(actor, part)) {
        rooms.add(part.operationId);
      }
    }
    return { report: { running: report.running, lastRounds, findings }, rooms: [...rooms] };
  }

  /**
   * Tell this person, who is connected now, of the findings they may see and
   * were not told of: how many there are; they count as told from here on.
   */
  tell(actor: OperationActor): number {
    const { findings, told, now } = this.deps;
    const since = Math.max(told.toldAt(actor.id) ?? 0, now() - TOLD_WINDOW_MS);
    const fresh = findings.announcedSince(since);
    const last = fresh.at(-1)?.announcedAt;
    // Up to the last one announced, whether theirs to see or not: none of these is asked about again.
    if (last) told.mark(actor.id, last.getTime());
    return fresh.filter((f) => this.maySee(actor, f)).length;
  }

  /** A client that just connected asks what its person missed. */
  news(actor: OperationActor): WatchdogNews {
    return {
      findings: this.tell(actor),
      agentName: (this.deps.rounds.agent()?.name ?? "The watchdog").slice(0, 40),
    };
  }

  async runNow(actor: OperationActor): Promise<WatchdogReport> {
    if (!isOfficeManager(actor.role)) throw new WatchdogError("owner_or_admin_required");
    try {
      const round = await this.deps.rounds.request("manual", actor.id);
      this.#audit(actor, AUDIT_ACTIONS.watchdogRoundRequest, round.id, { via: "button" });
    } catch (err) {
      if (err instanceof RoundRefusal) throw new WatchdogError(err.code, err.message);
      throw err;
    }
    return this.report(actor);
  }

  /** The finding, for a person who may see it; one they may not answers like one that is not there. */
  #finding(actor: OperationActor, findingId: string): FindingRow {
    const finding = this.deps.findings.finding(findingId);
    if (!finding || !this.maySee(actor, finding)) throw new WatchdogError("not_found");
    return finding;
  }

  decideFix(
    actor: OperationActor,
    findingId: string,
    decision: "open" | "decline",
  ): WatchdogFindingView {
    const { findings, fixes } = this.deps;
    const finding = this.#finding(actor, findingId);
    if (finding.scope !== "room" || !this.#mayDecide(actor, finding)) {
      throw new WatchdogError("forbidden", "you may not queue work in this room");
    }
    let after: FindingRow;
    try {
      after = decision === "open" ? fixes.open(finding, actor) : fixes.decline(finding, actor);
    } catch (err) {
      if (!(err instanceof FixError)) throw err;
      throw new WatchdogError(err.code === "conflict" ? "conflict" : "fix_refused", err.message);
    }
    this.#audit(actor, AUDIT_ACTIONS.watchdogFixDecide, finding.id, {
      decision,
      operationId: finding.operationId,
    });
    return this.#findingView(actor, after, findings.sources([after.id]));
  }

  /**
   * A person says a fault is known noise: from now on it stays dismissed and
   * nobody is told when it comes back. Or they take that back.
   */
  markNoise(actor: OperationActor, findingId: string, noise: boolean): WatchdogFindingView {
    const { findings, now } = this.deps;
    const finding = this.#finding(actor, findingId);
    if (!this.#mayDecide(actor, finding)) {
      throw new WatchdogError("forbidden", "you may not decide about this finding");
    }
    findings.patch(finding.id, {
      noiseBy: noise ? actor.id : null,
      noiseAt: noise ? new Date(now()) : null,
    });
    this.#audit(actor, AUDIT_ACTIONS.watchdogNoise, finding.id, { noise });
    const after = findings.finding(finding.id) ?? finding;
    return this.#findingView(actor, after, findings.sources([after.id]));
  }
}
