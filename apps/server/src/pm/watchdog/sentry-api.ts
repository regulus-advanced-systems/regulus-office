/**
 * Sentry, as the office reads and writes it for the watchdog (#253, D30): over
 * Sentry's REST API, from the office server, with the stored token decrypted
 * for each call. The token never reaches a runner or the model.
 *
 * Why not the Sentry MCP server in the watchdog's own session: the office has
 * to decide the facts itself (which watched project an issue is in, whether
 * Sentry says it regressed and when) and hand the model lines it can cite by
 * number. An MCP tool's answer is prose for a model, and the model's session
 * could ask it about issues of any project the token can read. So the office
 * reads, per watched project, and the model gets data.
 *
 * Read: the issues of one watched project, the last event of an issue, when
 * an issue last regressed. Write: one comment on an issue. Nothing here
 * resolves, ignores or assigns an issue.
 *
 * Bounds: a list is read in pages, up to `ISSUES_MAX` issues, and says when
 * Sentry has more; an answer larger than `BODY_MAX` bytes is not read; each
 * call has a time limit, and the caller has one for a whole project
 * (check.ts). The next page is asked for by Sentry's cursor only: no address
 * out of an answer is ever fetched.
 */
import type { Secret } from "@regulus/agent-adapters";

export interface SentryConnection {
  host: string;
  organization: string;
  token: Secret;
}

export interface SentryIssue {
  /** Sentry's own id of the issue (digits). */
  id: string;
  /** `WEB-1A2`. */
  shortId: string;
  /** The slug of the project Sentry says it is in. */
  project: string;
  title: string;
  culprit: string;
  level: string;
  count: number;
  userCount: number;
  firstSeen: number;
  lastSeen: number;
  /** Sentry's own state: `new`, `regressed`, `escalating`, `ongoing`, ... */
  substatus: string;
  permalink: string;
}

/** A short code (`http_403`, `network_error`, `bad_answer`, `answer_too_large`, `timed_out`); never Sentry's response text. */
export class SentryError extends Error {
  override name = "SentryError";
}

export interface SentryApi {
  /**
   * Unresolved issues of one project that match `query` (Sentry search
   * syntax), newest first, up to `ISSUES_MAX`. `more`: Sentry has others that
   * were not read.
   */
  issues(conn: SentryConnection, project: string, query: string): Promise<SentryIssues>;
  /** When Sentry last marked the issue as regressed, or null when it never did. */
  regressedAt(conn: SentryConnection, issueId: string): Promise<number | null>;
  /** The newest event of the issue as a few lines: exception, message, the top frames. */
  latestEvent(conn: SentryConnection, issueId: string): Promise<string[]>;
  comment(conn: SentryConnection, issueId: string, text: string): Promise<void>;
}

export interface SentryIssues {
  issues: SentryIssue[];
  more: boolean;
}

const TIMEOUT_MS = 15_000;
const PAGE = 25;
const PAGES_MAX = 4;
/** The most issues one list is read to. */
export const ISSUES_MAX = PAGE * PAGES_MAX;
/** An answer of Sentry's is read up to this many bytes. */
export const BODY_MAX = 2_000_000;
const ID = /^\d{1,24}$/;
const CURSOR = /^[0-9:]{1,60}$/;

/** The cursor of the next page from Sentry's `Link` header, when it says there are results. */
export function nextCursor(link: string | null): string | null {
  for (const part of (link ?? "").split(",")) {
    if (!/rel="next"/.test(part) || !/results="true"/.test(part)) continue;
    const cursor = /cursor="([^"]*)"/.exec(part)?.[1] ?? "";
    return CURSOR.test(cursor) ? cursor : null;
  }
  return null;
}

/** The body as text, or null when it is larger than `max` bytes. */
async function readBody(res: Response, max: number): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? 0) > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;
const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.slice(0, max) : "");
const time = (v: unknown): number => {
  const ms = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
};
const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export function parseIssue(raw: unknown): SentryIssue | null {
  const o = obj(raw);
  const id = str(o?.id, 24);
  const shortId = str(o?.shortId, 120).toUpperCase();
  if (!o || !ID.test(id) || !shortId) return null;
  return {
    id,
    shortId,
    project: str(obj(o.project)?.slug, 100).toLowerCase(),
    title: str(o.title),
    culprit: str(o.culprit),
    level: str(o.level, 20),
    count: count(o.count),
    userCount: count(o.userCount),
    firstSeen: time(o.firstSeen),
    lastSeen: time(o.lastSeen),
    substatus: str(o.substatus, 40),
    permalink: str(o.permalink, 400),
  };
}

/** The lines of an event a person would read first. */
export function eventLines(raw: unknown): string[] {
  const event = obj(raw);
  const lines: string[] = [];
  const message = str(event?.message) || str(event?.title);
  if (message) lines.push(message);
  for (const entry of Array.isArray(event?.entries) ? event.entries : []) {
    const e = obj(entry);
    if (e?.type !== "exception") continue;
    const values = obj(e.data)?.values;
    for (const value of Array.isArray(values) ? values.slice(-2) : []) {
      const v = obj(value);
      lines.push(`${str(v?.type, 80)}: ${str(v?.value)}`);
      const frames = obj(v?.stacktrace)?.frames;
      for (const frame of Array.isArray(frames) ? frames.slice(-6).reverse() : []) {
        const f = obj(frame);
        lines.push(
          `    at ${str(f?.function, 80) || "?"} (${str(f?.filename, 160)}:${count(f?.lineNo)})`,
        );
      }
    }
  }
  return lines.slice(0, 20);
}

export function httpSentryApi(doFetch: typeof fetch = fetch): SentryApi {
  async function call(conn: SentryConnection, path: string, init: RequestInit = {}) {
    let res: Response;
    try {
      res = await doFetch(`https://${conn.host}/api/0/${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${conn.token.reveal()}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SentryError("network_error");
    }
    if (!res.ok) throw new SentryError(`http_${res.status}`);
    let text: string | null;
    try {
      text = await readBody(res, BODY_MAX);
    } catch {
      throw new SentryError("network_error");
    }
    if (text === null) throw new SentryError("answer_too_large");
    try {
      return { body: JSON.parse(text) as unknown, next: nextCursor(res.headers.get("link")) };
    } catch {
      throw new SentryError("bad_answer");
    }
  }
  const org = (conn: SentryConnection) => encodeURIComponent(conn.organization);
  const issue = (conn: SentryConnection, id: string) => {
    if (!ID.test(id)) throw new SentryError("bad_issue_id");
    return `organizations/${org(conn)}/issues/${id}`;
  };

  return {
    async issues(conn, project, query) {
      const issues: SentryIssue[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < PAGES_MAX; page++) {
        const params = new URLSearchParams({ query, limit: String(PAGE), sort: "date" });
        if (cursor) params.set("cursor", cursor);
        const { body, next } = await call(
          conn,
          `projects/${org(conn)}/${encodeURIComponent(project)}/issues/?${params}`,
        );
        if (!Array.isArray(body)) throw new SentryError("bad_answer");
        issues.push(...body.slice(0, PAGE).flatMap((raw) => parseIssue(raw) ?? []));
        cursor = next;
        if (!cursor) return { issues, more: false };
      }
      return { issues, more: true };
    },
    async regressedAt(conn, issueId) {
      const body = obj((await call(conn, `${issue(conn, issueId)}/`)).body);
      let latest: number | null = null;
      for (const item of Array.isArray(body?.activity) ? body.activity : []) {
        const a = obj(item);
        if (a?.type !== "set_regression") continue;
        const at = time(a.dateCreated);
        if (at > (latest ?? 0)) latest = at;
      }
      return latest;
    },
    async latestEvent(conn, issueId) {
      return eventLines((await call(conn, `${issue(conn, issueId)}/events/latest/`)).body);
    },
    async comment(conn, issueId, text) {
      await call(conn, `${issue(conn, issueId)}/comments/`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
    },
  };
}
