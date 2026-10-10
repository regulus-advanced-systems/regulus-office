/**
 * Fixture for the watchdog's tests (#253): the office of `agentsOffice` (four
 * people, two rooms) with a watchdog on the fake engine, hosts read through
 * the real `SshProbe` and a local runner with the `ssh`, `ssh-keyscan` and
 * `pm2` stand-ins, a stand-in where Sentry's REST API would be, and a
 * recorder where the BuildingRoom would be.
 *
 * The fake engine stands in for the model: for each turn it runs the script
 * the test set, which calls the office tools with the token that turn was
 * given, exactly as a real engine's session would: its session token in a
 * conversation, the turn's own token in a turn of the office's own.
 */
import { chmodSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OFFICE_AGENTS_API_PATH,
  type OfficeToolResult,
  WATCHDOG_HOSTS_API_PATH,
  WATCHDOG_SENTRY_PROJECTS_API_PATH,
  WATCHDOG_SETTINGS_API_PATH,
  type WatchdogAlertPush,
  type WatchdogHostView,
  type WatchdogReportPush,
} from "@regulus/protocol";
import { captureLogger } from "../../../notifications/testing.ts";
import { LocalTmuxRunner } from "../../../runners/testing/local-tmux-runner.ts";
import { OFFICE_AGENT_RUNNER_USER } from "../../engines/cli-session.ts";
import type { EngineMessage } from "../../engines/types.ts";
import { APOLLO, agentsOffice } from "../../test-helpers.ts";
import { SshProbe } from "../probe.ts";
import {
  type SentryApi,
  type SentryConnection,
  SentryError,
  type SentryIssue,
} from "../sentry-api.ts";

export const FAKE_SSH = join(import.meta.dir, "fake-ssh.ts");
export const FAKE_KEYSCAN = join(import.meta.dir, "fake-keyscan.ts");
for (const file of [FAKE_SSH, FAKE_KEYSCAN, join(import.meta.dir, "fake-pm2.ts")]) {
  chmodSync(file, 0o755);
}
/** A made-up key in the right shape; it opens nothing. */
export const TEST_PRIVATE_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE\n-----END OPENSSH PRIVATE KEY-----";
export const TEST_SENTRY_TOKEN = "sntryu_FAKE0123456789abcdef0123456789abcdef0123456789abcdef";
/** The secret the PM2 stand-in puts into every process's environment. */
export const PM2_ENV_SECRET = "sk-ant-api03-FAKE-env-of-a-production-app-0123456789";
/** The keys the `ssh` stand-in's host shows: at first, and after `setApps(..., OTHER_HOST_KEY)`. */
export const FIRST_HOST_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFIRSTFIRSTFIRSTFIRSTFIRSTFIRSTFIRST";
export const OTHER_HOST_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOTHEROTHEROTHEROTHEROTHEROTHEROTHE";

export const STACK = [
  "2026-10-09T08:50:21.084Z TypeError: Cannot read properties of undefined (reading 'id')",
  "    at handler (/srv/app/src/routes/orders.js:42:17)",
  "upstream payments timed out after 3000 ms, password=hunter2",
];

export interface FakeApp {
  name: string;
  status?: string;
  restarts?: number;
  unstable?: number;
  log?: string[];
}

/** One turn as the script sees it. */
export interface Turn {
  message: EngineMessage;
  /** True in a turn the office gave the watchdog for a part of a round. */
  round: boolean;
  /** Call an office tool with the token this turn was given. */
  call(name: string, input?: Record<string, unknown>): Promise<OfficeToolResult>;
  /** The same, for a call that must succeed. */
  ok<T = Record<string, unknown>>(name: string, input?: Record<string, unknown>): Promise<T>;
  /** The tools this turn's token is offered. */
  tools(): Promise<string[]>;
}
export type Script = (turn: Turn) => Promise<string | null>;

export interface SignalView {
  key: string;
  from: "Sentry" | "PM2";
  summary: string;
  lines: Array<{ n: number; text: string }>;
  known?: { title: string; disposition: string };
  back?: string;
}
export interface CheckResult {
  signals: SignalView[];
  notRead: string[];
}

export const issue = (over: Partial<SentryIssue> & { shortId: string }): SentryIssue => ({
  id: String(1000 + Number.parseInt(over.shortId.replace(/\D/g, "") || "1", 10)),
  project: "web",
  title: "TypeError: Cannot read properties of undefined (reading 'id')",
  culprit: "handler(src/routes/orders)",
  level: "error",
  count: 14,
  userCount: 3,
  firstSeen: Date.now() - 600_000,
  lastSeen: Date.now() - 60_000,
  substatus: "new",
  permalink: "",
  ...over,
});

/** Sentry's REST API, in memory: what each project answers, and what was asked and written. */
export class FakeSentry implements SentryApi {
  projects: Record<string, SentryIssue[]> = {};
  regressions: Record<string, number> = {};
  events: Record<string, string[]> = {};
  fail: string | null = null;
  /** Projects that have more new issues than a list is read to. */
  more = new Set<string>();
  /** While set, a list of issues is not answered until it resolves. */
  hang: Promise<void> | null = null;
  readonly asked: Array<{ project: string; query: string; host: string }> = [];
  readonly comments: Array<{ issueId: string; text: string; host: string; organization: string }> =
    [];
  /** The lengths of the tokens it was called with (never the tokens). */
  readonly tokens = new Set<number>();

  #seen(conn: SentryConnection): void {
    this.tokens.add(conn.token.reveal().length);
    if (this.fail) throw new SentryError(this.fail);
  }
  async issues(conn: SentryConnection, project: string, query: string) {
    this.#seen(conn);
    this.asked.push({ project, query, host: conn.host });
    if (this.hang) await this.hang;
    const all = this.projects[project] ?? [];
    const regressed = query.includes("is:regressed");
    return {
      issues: regressed ? all.filter((i) => i.substatus === "regressed") : all,
      more: !regressed && this.more.has(project),
    };
  }
  async regressedAt(conn: SentryConnection, issueId: string) {
    this.#seen(conn);
    return this.regressions[issueId] ?? null;
  }
  async latestEvent(conn: SentryConnection, issueId: string) {
    this.#seen(conn);
    return this.events[issueId] ?? [];
  }
  async comment(conn: SentryConnection, issueId: string, text: string) {
    this.#seen(conn);
    this.comments.push({ issueId, text, host: conn.host, organization: conn.organization });
  }
}

export async function watchdogOffice() {
  const runner = await LocalTmuxRunner.create();
  const sentry = new FakeSentry();
  const pushes: Array<{ userId: string; type: string; payload: WatchdogReportPush }> = [];
  const alerts: Array<{ userId: string; payload: WatchdogAlertPush }> = [];
  let script: Script = async () => null;
  const logs: string[] = [];
  const probeLog = captureLogger();
  const o = await agentsOffice({
    fake: {
      reply: async (_agent, message, office) => {
        // Like a real engine: each turn has a token of its own, gone when the turn is.
        const engineTurn = office.turn?.(message.userId);
        const token = (engineTurn?.token ?? office.token).reveal();
        const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
        const call = async (name: string, input: Record<string, unknown> = {}) => {
          const res = await fetch(new URL(`/api/agent-tools/${name}`, o.office.server.url), {
            method: "POST",
            headers,
            body: JSON.stringify(input),
          });
          const body = (await res.json()) as OfficeToolResult;
          logs.push(JSON.stringify(body));
          return body;
        };
        const done = script({
          message,
          round: message.ephemeral === true,
          call,
          ok: async <T>(name: string, input: Record<string, unknown> = {}) => {
            const result = await call(name, input);
            if (!result.ok) throw new Error(`${name}: ${result.error}: ${result.message}`);
            return result.result as T;
          },
          tools: async () => {
            const res = await fetch(new URL("/api/agent-tools", o.office.server.url), { headers });
            const body = (await res.json()) as { tools?: Array<{ name: string }> };
            return (body.tools ?? []).map((t) => t.name);
          },
        });
        try {
          return await done;
        } finally {
          engineTurn?.end();
        }
      },
    },
    watchdog: {
      probe: new SshProbe({
        runner,
        logger: probeLog.logger,
        command: FAKE_SSH,
        keyscanCommand: FAKE_KEYSCAN,
      }),
      sentry,
      // A Sentry that does not answer is given up on quickly here.
      sentryDeadlineMs: 600,
    },
  });
  const watchdog = o.officeAgents.watchdog;
  watchdog.setSink({
    sendToUser: (userId, type, payload) => {
      if (type === "watchdog.alert") alerts.push({ userId, payload: payload as WatchdogAlertPush });
      else pushes.push({ userId, type, payload: payload as WatchdogReportPush });
    },
  });
  const home = (await runner.provision({ userId: OFFICE_AGENT_RUNNER_USER })).home;
  const ada = o.people.ada.cookie;
  const json = async <T>(res: Response) => (await res.json()) as T;

  /** The shared agent with the watchdog job, on an office key. */
  const profileId = o.addOfficeKey();
  const made = await o.send(OFFICE_AGENTS_API_PATH, "POST", ada, {
    name: "Cerberus",
    owner: "office",
    engine: "cli-session",
    role: "watchdog",
    provider: "claude-code",
    model: "haiku",
    profileId,
  });
  if (made.status !== 201) throw new Error(`watchdog not created: ${await made.text()}`);
  const agent = await json<{ id: string; appearance: string }>(made);
  const dir = `${home}/.regulus-office/office-agents/${agent.id}/watchdog`;

  return {
    ...o,
    runner,
    watchdog,
    agent,
    sentry,
    pushes,
    alerts,
    /** Every tool result the scripted watchdog got, as text. */
    toolResults: () => logs.join("\n"),
    /** Everything the office and the probe logged. */
    logText: () => `${o.log.text()}\n${probeLog.text()}`,
    setScript(next: Script) {
      script = next;
    },
    /** What the PM2 stand-in on the host answers from now on, and the key the host shows. */
    setApps: (apps: FakeApp[], hostKey = FIRST_HOST_KEY) =>
      writeFile(join(home, "fake-pm2-state.json"), JSON.stringify({ apps, hostKey })),
    /** What the `ssh` stand-in was given, one entry per call. */
    async sshCalls() {
      const text = await readFile(join(home, "fake-ssh.log"), "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((l) => l.length > 0)
        .map(
          (l) =>
            JSON.parse(l) as {
              argv: string[];
              host: string;
              remote: string[];
              key: { mode: string; sha256: string } | null;
              knownHosts: string;
              env: string[];
            },
        );
    },
    /** Whether the folder a check keeps the SSH key in exists on the runner's volume right now. */
    keyFolderExists: () =>
      stat(dir).then(
        () => true,
        () => false,
      ),
    /** Ada sets the watchdog up: Sentry project `web` and app `api` in Apollo, app `worker` in no room. */
    async configure(host = "prod-1.example.com") {
      const settings = await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", ada, {
        enabled: true,
        agentId: agent.id,
        sentryOrganization: "acme",
        sentryToken: TEST_SENTRY_TOKEN,
      });
      if (settings.status !== 200) throw new Error(`settings: ${await settings.text()}`);
      const projects = await o.send(WATCHDOG_SENTRY_PROJECTS_API_PATH, "PUT", ada, {
        projects: [{ slug: "web", operationId: APOLLO }],
        // Ada is an admin, not the owner: a project on the stored token needs the token again.
        sentryToken: TEST_SENTRY_TOKEN,
      });
      if (projects.status !== 200) throw new Error(`projects: ${await projects.text()}`);
      const res = await o.send(WATCHDOG_HOSTS_API_PATH, "POST", ada, {
        label: "prod-1",
        host,
        username: "watchdog",
        privateKey: TEST_PRIVATE_KEY,
        apps: [{ name: "api", operationId: APOLLO }, { name: "worker" }],
      });
      if (res.status !== 201) throw new Error(`host: ${await res.text()}`);
      return json<WatchdogHostView>(res);
    },
    /** Wait until no round is open (every part's turn has ended). */
    async settled() {
      for (let i = 0; i < 2000; i++) {
        await o.fake.idle();
        if (!watchdog.parts.openRound()) return;
        await Bun.sleep(5);
      }
      throw new Error("the round did not end");
    },
    /** Ask for a round as the schedule does and wait until every part's turn has ended. */
    async round(trigger: "schedule" | "manual" = "schedule") {
      const row = await watchdog.rounds.request(trigger, null);
      for (let i = 0; i < 2000; i++) {
        await o.fake.idle();
        if (!watchdog.parts.openRound()) break;
        await Bun.sleep(5);
      }
      return {
        round: watchdog.parts.round(row.id),
        parts: watchdog.parts.parts(row.id),
      };
    },
    async stopAll() {
      await o.stop();
      await runner.dispose();
    },
  };
}

export type WatchdogOffice = Awaited<ReturnType<typeof watchdogOffice>>;

/** The usual script of one part: read, record what `judge` says for each new signal, finish. */
export function judging(
  judge: (signal: SignalView) => Record<string, unknown> | null,
  seen?: (check: CheckResult, turn: Turn) => void | Promise<void>,
): Script {
  return async (turn) => {
    if (!turn.round) return "I only do rounds here.";
    const check = await turn.ok<CheckResult>("watchdog_check");
    await seen?.(check, turn);
    for (const signal of check.signals) {
      if (signal.known) continue;
      const verdict = judge(signal);
      if (!verdict) continue;
      await turn.ok("watchdog_record_finding", {
        title: signal.summary.slice(0, 150),
        sources: [{ key: signal.key }],
        disposition: "notify",
        reason: "new",
        ...verdict,
      });
    }
    await turn.ok("watchdog_finish_round", { summary: `judged ${check.signals.length}` });
    return "done";
  };
}
