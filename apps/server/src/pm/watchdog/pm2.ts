/**
 * Reading PM2 on a host, the pure part (#253, D30): the two fixed commands
 * the office runs over SSH, how their output is read, and what in it is a
 * *signal* worth the watchdog's judgement.
 *
 * Read-only by construction, not only by the remote user's rights: the
 * office runs exactly `pm2 jlist` and `pm2 logs <app> --err --nostream`,
 * with an app name that passed `WatchdogAppName` (no spaces, no shell
 * characters). The model never writes a command.
 *
 * A signal has a key the office makes, so the same fault is the same finding
 * on every round whatever words the model finds for it:
 *
 * - `pm2:<appId>:missing:<day>`   the app is not in the process list
 * - `pm2:<appId>:down:<day>`      its status is not `online`
 * - `pm2:<appId>:restarts:<day>`  it restarted since the last round
 * - `pm2:<appId>:err:<hash>`      an error line (numbers and ids taken out) new since the last round
 *
 * State signals carry the UTC day: one finding per app, kind and day. An
 * error line that comes back after {@link RECUR_AFTER_MS} without being seen
 * counts as regressed (findings.ts).
 */
import { createHash } from "node:crypto";
import { cleanLine, scrubEvidence } from "./evidence.ts";

export const LOG_LINES = 300;
/** A known error line seen again after this long without it gets a new verdict. */
export const RECUR_AFTER_MS = 7 * 24 * 60 * 60_000;
const GROUPS_MAX = 8;
const SAMPLE_LINES = 6;

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  /** Path of the private key file in the runner. */
  keyPath: string;
  knownHostsPath: string;
  /** True when the admin gave the host's key: anything else is refused. */
  pinned: boolean;
}

/** `ssh` for one fixed remote command. Nothing here comes from the model or from the host. */
export function sshArgv(target: SshTarget, remote: readonly string[]): string[] {
  return [
    "ssh",
    "-F",
    "/dev/null",
    "-i",
    target.keyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "IdentityAgent=none",
    "-o",
    `StrictHostKeyChecking=${target.pinned ? "yes" : "accept-new"}`,
    "-o",
    `UserKnownHostsFile=${target.knownHostsPath}`,
    "-o",
    "GlobalKnownHostsFile=/dev/null",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "RequestTTY=no",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "LogLevel=ERROR",
    "-p",
    String(target.port),
    "-l",
    target.username,
    "--",
    target.host,
    ...remote,
  ];
}

export const PM2_LIST: readonly string[] = ["pm2", "jlist"];
export const pm2Logs = (app: string): string[] => [
  "pm2",
  "logs",
  app,
  "--err",
  "--nostream",
  "--raw",
  "--lines",
  String(LOG_LINES),
];

export interface Pm2Process {
  name: string;
  status: string;
  restarts: number;
  unstableRestarts: number;
  /** When it was last started, ms since the epoch; 0 when unknown. */
  startedAt: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * `pm2 jlist` prints one JSON array; an update notice or a daemon banner may
 * stand before it. Null when there is no such array.
 */
export function parseJlist(stdout: string): Pm2Process[] | null {
  const candidates = [stdout.trim(), ...stdout.split("\n").reverse()];
  for (const text of candidates) {
    const start = text.indexOf("[");
    if (start < 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const out: Pm2Process[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const env = (raw.pm2_env ?? {}) as Record<string, unknown>;
      if (typeof raw.name !== "string") continue;
      out.push({
        name: raw.name,
        status: typeof env.status === "string" ? env.status.slice(0, 40) : "unknown",
        restarts: num(env.restart_time),
        unstableRestarts: num(env.unstable_restarts),
        startedAt: num(env.pm_uptime),
      });
    }
    return out;
  }
  return null;
}

/** The lines of `pm2 logs --nostream --raw`, without PM2's own headers. */
export function logLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => cleanLine(line))
    .filter(
      (line) =>
        line.trim().length > 0 && !line.startsWith("[TAILING]") && !/ last \d+ lines:$/.test(line),
    );
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** How many trailing lines mark a place: enough to span a stack trace and reach a timestamp. */
const MARK_LINES = 8;

/** What marks "read up to here": the last lines, hashed. Null for an empty log. */
export function logMark(lines: readonly string[]): string | null {
  return lines.length === 0 ? null : hash(lines.slice(-MARK_LINES).join("\n")).slice(0, 24);
}

/**
 * The lines after the place the last finished round read to. When that place
 * is not in the window (the log rotated, or more than the window was
 * written), every line is new.
 *
 * A crash loop writes the same lines over and over, so the place can match
 * more than once. The *earliest* match is taken: a line may then be read
 * twice (it is the same signal with the same key, so nothing is told twice),
 * but a line that is new is never skipped.
 */
export function linesSince(lines: readonly string[], mark: string | null): string[] {
  if (mark === null) return [...lines];
  for (let end = 1; end <= lines.length; end += 1) {
    if (logMark(lines.slice(0, end)) === mark) return lines.slice(end);
  }
  return [...lines];
}

/** A line with what differs between two occurrences of the same error taken out. */
export function lineSignature(line: string): string {
  return line
    .replace(/^\s*\[?\d{4}-\d{2}-\d{2}[T ][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/, "")
    .replace(/^\s*\d+\|\S+\s*\|\s*/, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "#")
    .replace(/\b0x[0-9a-f]+\b/gi, "#")
    .replace(/\b[0-9a-f]{12,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

export interface ErrorGroup {
  signature: string;
  count: number;
  /** The first occurrence with the lines that follow it (its stack), scrubbed. */
  sample: string[];
}

/** A stack frame or another continuation of the line above. */
const isContinuation = (line: string) => /^\s+\S/.test(line) || /^\s*at /.test(line);

/** New error lines by signature, most frequent first. */
export function errorGroups(lines: readonly string[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  let current: ErrorGroup | undefined;
  let fresh = false;
  for (const line of lines) {
    if (isContinuation(line) && current) {
      if (fresh && current.sample.length < SAMPLE_LINES) current.sample.push(scrubEvidence(line));
      continue;
    }
    const signature = lineSignature(scrubEvidence(line));
    if (!signature) continue;
    const known = groups.get(signature);
    if (known) {
      known.count += 1;
      current = known;
      fresh = false;
    } else {
      current = { signature, count: 1, sample: [scrubEvidence(line)] };
      groups.set(signature, current);
      fresh = true;
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, GROUPS_MAX);
}

export interface Pm2Signal {
  key: string;
  kind: "missing" | "down" | "restarts" | "error";
  summary: string;
  lines: string[];
}

export interface AppMarks {
  restarts: number | null;
  status: string | null;
  logMark: string | null;
}

export interface AppReading {
  /** What the next round compares with, once this one finishes. */
  marks: AppMarks;
  status: string;
  restarts: number;
  restartsSinceLastRound: number | null;
  upSince: number | null;
  signals: Pm2Signal[];
}

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/** One app's state and what is new in it since `before`. `process` undefined: not in the list. */
export function readApp(
  app: { id: string; name: string },
  process: Pm2Process | undefined,
  log: readonly string[] | null,
  before: AppMarks,
  now: number,
): AppReading {
  const prefix = `pm2:${app.id}`;
  if (!process) {
    return {
      marks: { restarts: before.restarts, status: "missing", logMark: before.logMark },
      status: "missing",
      restarts: 0,
      restartsSinceLastRound: null,
      upSince: null,
      signals: [
        {
          key: `${prefix}:missing:${day(now)}`,
          kind: "missing",
          summary: `${app.name} is not in the PM2 process list`,
          lines: [],
        },
      ],
    };
  }
  const signals: Pm2Signal[] = [];
  if (process.status !== "online") {
    signals.push({
      key: `${prefix}:down:${day(now)}`,
      kind: "down",
      summary: `${app.name} is ${process.status}, not online`,
      lines: [],
    });
  }
  // A counter that went down means PM2 or the app was reset: start counting again.
  const delta =
    before.restarts === null || process.restarts < before.restarts
      ? null
      : process.restarts - before.restarts;
  if (delta !== null && delta > 0) {
    const loop = delta >= 3 || process.unstableRestarts > 0;
    signals.push({
      key: `${prefix}:restarts:${day(now)}`,
      kind: "restarts",
      summary: `${app.name} restarted ${delta} time${delta === 1 ? "" : "s"} since the last round${loop ? " (crash loop)" : ""}; ${process.restarts} in all`,
      lines: [],
    });
  }
  const mark = log ? logMark(log) : before.logMark;
  if (log) {
    for (const group of errorGroups(linesSince(log, before.logMark))) {
      signals.push({
        key: `${prefix}:err:${hash(group.signature).slice(0, 16)}`,
        kind: "error",
        summary: `${group.count} new error line${group.count === 1 ? "" : "s"} like this in ${app.name}'s error log`,
        lines: group.sample,
      });
    }
  }
  return {
    marks: { restarts: process.restarts, status: process.status, logMark: mark },
    status: process.status,
    restarts: process.restarts,
    restartsSinceLastRound: delta,
    upSince: process.startedAt > 0 ? process.startedAt : null,
    signals,
  };
}

/** The app a PM2 signal key belongs to, or null for anything that is not such a key. */
export function appOfSignalKey(key: string): string | null {
  return (
    /^pm2:([A-Za-z0-9-]{1,64}):(?:missing|down|restarts|err)(?::[A-Za-z0-9-]{1,32})$/.exec(
      key,
    )?.[1] ?? null
  );
}

/** Whether the key is one that recurs: an error line, as opposed to a state of one day. */
export const isErrorKey = (key: string) => /^pm2:[^:]+:err:/.test(key);
