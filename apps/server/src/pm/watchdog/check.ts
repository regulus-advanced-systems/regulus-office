/**
 * The reading for one part of a round (#253, D30): the office reads this
 * part's targets, one room's or those without a room, and nothing else, and
 * turns what it read into signals for the watchdog to judge.
 *
 * - Sentry: the unresolved issues of each watched project of this room that
 *   are new since the last round, and those Sentry marks as regressed. An
 *   issue Sentry says is in another project is dropped. Whether a known issue
 *   is *back* is Sentry's own record: a regression later than its verdict.
 *   When Sentry has more new issues than a round reads, the part says so
 *   ("not read") and the project's window stays where it is until a round
 *   has read them all (`unreadSince`). A project that does not answer within
 *   its deadline is "not read", and the rest of the part is read all the same.
 * - PM2: the watched apps of this room on each host (probe.ts, pm2.ts).
 *
 * What a host or Sentry said is attacker-influenced text: it is cleaned and
 * scrubbed here and handed on as data.
 */
import type { Secret } from "@regulus/agent-adapters";
import { sentrySourceKey } from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import { cleanLine, scrubEvidence } from "./evidence.ts";
import type { FindingRow, FindingStore } from "./findings.ts";
import type { PartRow } from "./parts.ts";
import { type AppMarks, isErrorKey, RECUR_AFTER_MS } from "./pm2.ts";
import { HostKeyChanged, type HostProbe, ProbeError } from "./probe.ts";
import type { SentryApi, SentryConnection, SentryIssue } from "./sentry-api.ts";
import { ISSUES_MAX, SentryError } from "./sentry-api.ts";
import { type Signal, signalView, storedKey } from "./signals.ts";
import { WatchdogSecretError, type WatchdogStore } from "./store.ts";

/** Issues of one project whose last event is fetched for its lines. */
const EVENTS_PER_PROJECT = 8;
/** Everything the office asks Sentry about one project in one part takes at most this long. */
export const PROJECT_DEADLINE_MS = 60_000;

export interface CheckDeps {
  store: WatchdogStore;
  findings: FindingStore;
  probe: HostProbe | undefined;
  sentry: SentryApi;
  logger: Logger;
  now: () => number;
  /** A pinned host showed another key: tell the people who run the office. */
  hostKeyChanged: (host: { id: string; label: string }) => void;
  /** In place of `PROJECT_DEADLINE_MS` (tests). */
  sentryDeadlineMs?: number;
}

export interface PartReading {
  signals: Signal[];
  marks: Record<string, AppMarks>;
  /** What could not be read, each with why; names only this part's targets. */
  unreachable: string[];
  /** Ids of the Sentry projects that have more new issues than were read. */
  truncated: string[];
  /** The signals as the model is given them. */
  view: ReturnType<typeof signalView>[];
}

const line = (text: string) => scrubEvidence(cleanLine(text));
const iso = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : "unknown");

/** The Sentry search window: back to the last finished round and an hour more; 2 h to 7 days. */
export const windowHours = (since: number | undefined, now: number) =>
  Math.min(7 * 24, Math.max(2, Math.ceil((now - (since ?? now - 23 * 3_600_000)) / 3_600_000) + 1));

export function sentryConnection(store: WatchdogStore): SentryConnection | null {
  const settings = store.settings();
  if (!settings.sentryOrganization || !settings.encryptedSentryToken) return null;
  let token: Secret | null = null;
  try {
    token = store.sentryToken();
  } catch (err) {
    if (!(err instanceof WatchdogSecretError)) throw err;
  }
  return token
    ? { host: settings.sentryHost, organization: settings.sentryOrganization, token }
    : null;
}

export async function readPart(
  deps: CheckDeps,
  part: Pick<PartRow, "operationId">,
  agentId: string,
  since: number | undefined,
): Promise<PartReading> {
  const { store, findings, now } = deps;
  const room = part.operationId;
  const signals: Signal[] = [];
  const marks: Record<string, AppMarks> = {};
  const unreachable: string[] = [];
  const truncated: string[] = [];
  /** The finding a signal's key already belongs to in this room. */
  const before = (key: string): FindingRow | undefined =>
    findings.known([storedKey(key, room)]).get(storedKey(key, room));

  // ---- Sentry --------------------------------------------------------------------
  const projects = store.sentryProjects().filter((p) => p.operationId === room);
  const conn = projects.length > 0 ? sentryConnection(store) : null;
  if (projects.length > 0 && !conn) unreachable.push("Sentry: no organisation or token is set");
  for (const project of conn ? projects : []) {
    try {
      // From where its issues were last read whole, if that is further back.
      const from = Math.min(
        since ?? Number.POSITIVE_INFINITY,
        project.unreadSince?.getTime() ?? Number.POSITIVE_INFINITY,
      );
      const read = await within(deps.sentryDeadlineMs ?? PROJECT_DEADLINE_MS, (expired) =>
        readProject(
          deps,
          conn as SentryConnection,
          project.slug,
          Number.isFinite(from) ? from : undefined,
          before,
          expired,
        ),
      );
      signals.push(...read.signals);
      unreachable.push(...read.notRead);
      if (read.newFrom !== null) {
        truncated.push(project.id);
        store.setUnread([project.id], read.newFrom);
      }
    } catch (err) {
      if (!(err instanceof SentryError)) throw err;
      unreachable.push(`Sentry project ${project.slug}: ${err.message}`);
    }
  }

  // ---- PM2 -----------------------------------------------------------------------
  for (const host of store.hosts()) {
    const apps = store.apps(host.id).filter((a) => a.operationId === room);
    if (apps.length === 0) continue;
    if (!deps.probe) {
      unreachable.push(`${host.label}: this office cannot reach hosts`);
      continue;
    }
    try {
      const reading = await deps.probe.check(agentId, host, store.hostKey(host), apps, (app) =>
        store.marksOf(app),
      );
      if (reading.learnedKey) store.pins.learn(host.id, reading.learnedKey);
      if (host.offeredAt !== null) store.pins.clearOffer(host.id);
      for (const { app, reading: r } of reading.apps) {
        marks[app.id] = r.marks;
        for (const s of r.signals) {
          const known = before(s.key);
          signals.push({
            key: s.key,
            kind: "pm2",
            label: `${app.name} on ${host.label}`,
            summary: s.summary,
            lines: s.lines,
            // An error line that was judged before and is back after a week without it.
            regressed:
              known !== undefined &&
              known.noiseBy === null &&
              isErrorKey(s.key) &&
              now() - known.lastSeenAt.getTime() > RECUR_AFTER_MS,
          });
        }
      }
    } catch (err) {
      if (err instanceof HostKeyChanged) {
        if (store.pins.offer(host.id, err.offered)) deps.hostKeyChanged(host);
        unreachable.push(`${host.label}: ${err.message}; an admin has to look`);
      } else if (err instanceof ProbeError) {
        unreachable.push(`${host.label}: ${err.message}`);
      } else if (err instanceof WatchdogSecretError) {
        unreachable.push(`${host.label}: the office cannot read this host's key`);
      } else {
        deps.logger.error(
          { hostId: host.id, err: String(err).slice(0, 200) },
          "watchdog check failed",
        );
        unreachable.push(`${host.label}: the check failed`);
      }
    }
  }

  // Still there with nothing new to say: it stays one finding, and "a week without it" counts from now.
  const still: string[] = [];
  const view = signals.map((signal) => {
    const known = before(signal.key);
    if (known && !signal.regressed) still.push(known.id);
    return signalView(
      signal,
      known
        ? { title: known.title, disposition: known.noiseBy ? "dismiss" : known.disposition }
        : undefined,
    );
  });
  findings.seenAgain(still);
  return { signals, marks, unreachable, truncated, view };
}

/** `run`, or a `SentryError` when it takes longer than `ms`; `expired` tells it to ask nothing more. */
async function within<T>(ms: number, run: (expired: () => boolean) => Promise<T>): Promise<T> {
  let late = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      late = true;
      reject(new SentryError("timed_out"));
    }, ms);
  });
  const work = run(() => late);
  // Abandoned when it is late; what it still throws is nobody's.
  work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface ProjectReading {
  signals: Signal[];
  /** Lines for the part's "not read". */
  notRead: string[];
  /** Sentry has more new issues than were read: the start of the window they are in; else null. */
  newFrom: number | null;
}

async function readProject(
  deps: CheckDeps,
  conn: SentryConnection,
  project: string,
  since: number | undefined,
  before: (key: string) => FindingRow | undefined,
  expired: () => boolean,
): Promise<ProjectReading> {
  const window = windowHours(since, deps.now());
  const found = new Map<string, SentryIssue>();
  const notRead: string[] = [];
  let newFrom: number | null = null;
  const queries = [
    { query: `is:unresolved firstSeen:-${window}h`, what: "new" },
    { query: "is:unresolved is:regressed", what: "regressed" },
  ];
  for (const { query, what } of queries) {
    const list = await deps.sentry.issues(conn, project, query);
    for (const issue of list.issues) {
      // Only what Sentry itself says is in this watched project.
      if (issue.project === project) found.set(issue.id, issue);
    }
    if (!list.more) continue;
    notRead.push(
      `Sentry project ${project}: more than ${ISSUES_MAX} ${what} issues; only the ${ISSUES_MAX} most recent were read`,
    );
    if (what === "new") newFrom = deps.now() - window * 3_600_000;
  }
  const out: Signal[] = [];
  let events = 0;
  for (const issue of found.values()) {
    if (expired()) throw new SentryError("timed_out");
    const key = sentrySourceKey(conn.organization, issue.shortId);
    const known = before(key);
    let regressed = false;
    if (known && known.noiseBy === null && issue.substatus === "regressed") {
      // Back, by Sentry's own record: it marked a regression after the verdict was given.
      const at = await deps.sentry.regressedAt(conn, issue.id).catch(() => null);
      regressed = at !== null && at > known.judgedAt.getTime();
    }
    let event: string[] = [];
    if ((!known || regressed) && events < EVENTS_PER_PROJECT) {
      events += 1;
      event = await deps.sentry.latestEvent(conn, issue.id).catch(() => []);
    }
    out.push({
      key,
      kind: "sentry",
      label: issue.shortId,
      summary: `${issue.shortId} in ${project}: ${line(issue.title)}`,
      lines: [
        line(issue.title),
        ...(issue.culprit ? [`in ${line(issue.culprit)}`] : []),
        `${issue.level || "error"}: ${issue.count} events, ${issue.userCount} users`,
        `first seen ${iso(issue.firstSeen)}, last seen ${iso(issue.lastSeen)}`,
        `Sentry state: ${issue.substatus || "unresolved"}`,
        ...event.map(line),
      ],
      // Built here from what the office set, not taken from Sentry's answer or the model.
      url: `https://${conn.host}/organizations/${conn.organization}/issues/${issue.id}/`,
      project,
      ref: issue.id,
      regressed,
    });
  }
  return { signals: out, notRead, newFrom };
}
