/**
 * Test fixtures for notifications (#42): a local fake of Slack, Discord and
 * Telegram (no request ever reaches the real services), a seeded database,
 * and a logger that captures every line so tests can assert no secret leaks.
 */
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { agents, desks, operationRepos, operations } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { testDb } from "../operations/test-helpers.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import { DEFAULT_SENDER_POLICY, type SenderPolicy } from "./senders.ts";

export interface FakeRequest {
  path: string;
  body: Record<string, unknown>;
}

export interface FakeReply {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

/** One local server answering like all three providers. */
export function startFakeWebhooks() {
  const requests: FakeRequest[] = [];
  /** Replies to use next, in order; afterwards each provider's success reply. */
  const script: FakeReply[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
      requests.push({ path: url.pathname, body });
      const next = script.shift();
      if (next)
        return new Response(next.body ?? "", { status: next.status, headers: next.headers });
      if (url.pathname.startsWith("/services/")) return new Response("ok");
      if (url.pathname.startsWith("/api/webhooks/")) return new Response(null, { status: 204 });
      if (/^\/bot[^/]+\/sendMessage$/.test(url.pathname)) {
        return Response.json({ ok: true, result: { message_id: requests.length } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const host = `127.0.0.1:${server.port}`;
  return {
    base,
    host,
    requests,
    script,
    slackUrl: `${base}/services/T000/B000/fakeSlackSecret123`,
    discordUrl: `${base}/api/webhooks/123456/fakeDiscordSecret_abc`,
    telegramToken: "123456789:FAKEtelegramTokenForTestsOnly_0123",
    policy(extra: Partial<SenderPolicy> = {}): SenderPolicy {
      return {
        ...DEFAULT_SENDER_POLICY,
        slackHosts: [host],
        discordHosts: [host],
        telegramApiBase: base,
        allowHttp: true,
        timeoutMs: 2_000,
        ...extra,
      };
    },
    stop: () => server.stop(true),
  };
}

export type FakeWebhooks = ReturnType<typeof startFakeWebhooks>;

export function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const logger = createLogger({ level: "debug", destination });
  return { logger, text: () => lines.join("") };
}

export function testKeyring(): MasterKeyring {
  return { current: 1, keys: { 1: randomBytes(32) } } as unknown as MasterKeyring;
}

/** Users, two operations with a repo each, and one henchman per operation. */
export function seededDb() {
  const { db, addUser } = testDb();
  const owner = addUser("Olga", "owner");
  const admin = addUser("Ada", "admin");
  const member = addUser("Mia", "member");
  const other = addUser("Sam", "member");
  for (const [n, id] of ["operation-1", "operation-2"].entries()) {
    db.insert(operations)
      .values({
        id,
        name: n === 0 ? "Web app" : "API",
        slug: id,
        index: n + 1,
        paletteId: "oak-sky",
        layoutTemplateId: "t",
      })
      .run();
    db.insert(operationRepos)
      .values({
        id: `repo-${n + 1}`,
        operationId: id,
        owner: "octo",
        name: n === 0 ? "web" : "api",
        url: "file:///dev/null",
        defaultBranch: "main",
        workdir: "/nonexistent",
        isPrimary: true,
        cloneStatus: "ready",
      })
      .run();
    db.insert(desks).values({ operationId: id, seatId: "seat-1" }).run();
  }
  const addAgent = (
    id: string,
    operation: 1 | 2,
    ownerUserId: string,
    prNumber: number | null = null,
  ) =>
    db
      .insert(agents)
      .values({
        id,
        operationId: `operation-${operation}`,
        repoId: `repo-${operation}`,
        deskSeatId: "seat-1",
        ownerUserId,
        provider: "codex",
        model: "gpt-test",
        profileId: "login:codex",
        status: "working",
        workdir: "/nonexistent",
        taskTitle: "Fix the login page",
        prNumber,
      })
      .run();
  return { db, owner, admin, member, other, addAgent };
}
