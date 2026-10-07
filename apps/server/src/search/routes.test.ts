/**
 * Search over HTTP with real sessions: the ACL matrix (chat by operation
 * visibility, scrollback by exactly the terminal watch audience, D12),
 * snippets, the context endpoint, sanitised queries and the rate limit.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  SEARCH_API_PATH,
  SEARCH_CONTEXT_API_PATH,
  type SearchContextResponse,
  type SearchResponse,
  type UserRole,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { TokenBucketLimiter } from "../auth/rate-limit.ts";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { agents, userProfiles } from "../db/schema/index.ts";
import { dbOperationVisibility, decideTerminalAccess } from "../terminals/acl.ts";
import { mountSearchRoutes } from "./routes.ts";
import { Searcher } from "./searcher.ts";
import {
  addChat,
  addHenchman,
  addMember,
  addOperation,
  exitHenchman,
  indexerFor,
  silent,
  tempDir,
} from "./testing.ts";

type User = { id: string; cookie: string; role: UserRole };
let office: Office;
const tmp = tempDir();
const users: Record<string, User> = {};
let limiter: TokenBucketLimiter;

async function user(name: string, role: UserRole): Promise<User> {
  const u = await office.signUp(name);
  office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, u.id)).run();
  return { ...u, role };
}

beforeAll(async () => {
  office = startOffice();
  const db = office.db;
  users.owner = await user("Olga", "owner");
  users.admin = await user("Ada", "admin");
  users.henchmanOwner = await user("Rob", "member");
  users.member = await user("Mia", "member");
  users.viewer = await user("Vic", "viewer");
  users.outsider = await user("Otto", "member");
  addOperation(db, "f1");
  addOperation(db, "f2");
  addOperation(db, "f3", true);
  addMember(db, "f1", users.henchmanOwner.id, "spawn");
  addMember(db, "f1", users.member.id, "spawn");
  addMember(db, "f1", users.viewer.id, "view");
  addMember(db, "f3", users.member.id, "spawn");
  addHenchman(db, "a1", "f1", users.henchmanOwner.id); // live, f1
  addHenchman(db, "a2", "f2", users.owner.id); // live, f2 (nobody is a member)
  addHenchman(db, "a3", "f1", users.henchmanOwner.id); // exited
  addHenchman(db, "a4", "f3", users.member.id); // archived operation
  exitHenchman(db, "a3");
  addChat(db, "needle in the lobby");
  addChat(db, "needle said on f1", "f1");
  addChat(db, "needle said on f2", "f2");
  addChat(db, "needle said on f3", "f3");
  const indexer = indexerFor(db, tmp.dir);
  indexer.syncChat();
  const screen = (tag: string) =>
    [`$ make ${tag}`, "compiling...", `needle found by ${tag}`, "done", "$"].join("\n");
  for (const id of ["a1", "a2", "a3", "a4"]) indexer.indexSnapshot(id, "f?", screen(id), 1);
  // indexSnapshot takes the operation from the caller; the searcher trusts the agents row instead.
  limiter = new TokenBucketLimiter({ capacity: 1000, refillPerSecond: 1000 });
  mountSearchRoutes(office.server.router, {
    auth: office.auth,
    searcher: new Searcher({ db, canViewOperation: dbOperationVisibility(db) }),
    logger: silent,
    limiter,
  });
});

afterAll(async () => {
  await office.stop();
  tmp.cleanup();
});

const search = (u: User | undefined, q: string) =>
  office.request(`${SEARCH_API_PATH}?q=${encodeURIComponent(q)}`, { cookie: u?.cookie });

async function keys(u: User, q = "needle"): Promise<string[]> {
  const res = await search(u, q);
  expect(res.status).toBe(200);
  const body = (await res.json()) as SearchResponse;
  return body.groups.map((g) => g.key).sort();
}

describe("ACL matrix", () => {
  test.each([
    ["office owner", "owner", ["chat:f1", "chat:f2", "chat:lobby", "henchman:a1", "henchman:a2"]],
    ["admin", "admin", ["chat:f1", "chat:f2", "chat:lobby", "henchman:a1", "henchman:a2"]],
    ["henchman owner", "henchmanOwner", ["chat:f1", "chat:lobby", "henchman:a1"]],
    ["other member on the operation", "member", ["chat:f1", "chat:lobby", "henchman:a1"]],
    ["viewer on the operation", "viewer", ["chat:f1", "chat:lobby", "henchman:a1"]],
    ["member of no operation", "outsider", ["chat:lobby"]],
  ])("%s", async (_name, who, want) => {
    expect(await keys(users[who] as User)).toEqual(want);
  });

  test("scrollback is visible to exactly the terminal's watch audience", async () => {
    const db = office.db;
    const canView = dbOperationVisibility(db);
    for (const u of Object.values(users)) {
      const found = new Set((await keys(u)).filter((k) => k.startsWith("henchman:")));
      for (const [id, ownerId, operationId, live] of [
        ["a1", users.henchmanOwner?.id, "f1", true],
        ["a2", users.owner?.id, "f2", true],
        ["a3", users.henchmanOwner?.id, "f1", false],
        ["a4", users.member?.id, "f3", true],
      ] as const) {
        const watch =
          live &&
          decideTerminalAccess(u, { ownerUserId: ownerId ?? "", operationId }, "watch", canView).ok;
        expect({ user: u.role, id, found: found.has(`henchman:${id}`) }).toEqual({
          user: u.role,
          id,
          found: watch,
        });
      }
    }
  });

  test("groups carry what the jump needs, snippets are structured", async () => {
    const res = await search(users.member, "needle");
    const body = (await res.json()) as SearchResponse;
    const henchman = body.groups.find((g) => g.key === "henchman:a1");
    expect(henchman).toMatchObject({
      kind: "scrollback",
      operationId: "f1",
      operationName: "Operation f1",
      agentId: "a1",
      seatId: "desk-a1",
      henchmanName: "task a1",
      ownerName: "Rob",
    });
    // A named henchman is found under its own name, its owner next to it (#256).
    office.db.update(agents).set({ name: "Gasket" }).where(eq(agents.id, "a1")).run();
    const named = (await (await search(users.member, "needle")).json()) as SearchResponse;
    expect(named.groups.find((g) => g.key === "henchman:a1")).toMatchObject({
      henchmanName: "Gasket",
      ownerName: "Rob",
    });
    office.db.update(agents).set({ name: "" }).where(eq(agents.id, "a1")).run();
    const segments = henchman?.hits[0]?.snippet ?? [];
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(["needle"]);
    expect(segments.map((s) => s.text).join("")).toContain("needle found by a1");
    const lobby = body.groups.find((g) => g.key === "chat:lobby");
    expect(lobby).toMatchObject({ operationName: "Lobby" });
    expect(lobby?.hits[0]?.author).toBe("Ada");
    expect(body.terms).toEqual(["needle"]);
  });
});

describe("context", () => {
  const docOf = async (u: User, agentId: string) => {
    const body = (await (await search(u, "needle")).json()) as SearchResponse;
    return body.groups.find((g) => g.agentId === agentId)?.hits[0]?.docId;
  };

  test("returns the lines around the hit with the matching line", async () => {
    const doc = await docOf(users.member as User, "a1");
    const res = await office.request(`${SEARCH_CONTEXT_API_PATH}?doc=${doc}&q=needle`, {
      cookie: users.member?.cookie,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchContextResponse;
    expect(body.agentId).toBe("a1");
    expect(body.lines[body.matchLine]).toBe("needle found by a1");
  });

  test("is 404 for someone who may not watch the henchman", async () => {
    const doc = await docOf(users.owner as User, "a2");
    expect(doc).toBeDefined();
    for (const who of ["member", "outsider", "viewer"]) {
      const res = await office.request(`${SEARCH_CONTEXT_API_PATH}?doc=${doc}`, {
        cookie: users[who]?.cookie,
      });
      expect(res.status).toBe(404);
    }
  });

  test("a bad doc id is a 400", async () => {
    for (const doc of ["", "abc", "-1", "1.5"]) {
      const res = await office.request(`${SEARCH_CONTEXT_API_PATH}?doc=${doc}`, {
        cookie: users.owner?.cookie,
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("input handling", () => {
  test("needs a session", async () => {
    expect((await search(undefined, "needle")).status).toBe(401);
  });

  test("FTS5 syntax in the query is plain text, never an error", async () => {
    for (const q of ['needle" OR body:*', "NEAR(needle", "needle AND", "*", "body:needle"]) {
      const res = await search(users.owner, q);
      expect(res.status).toBe(200);
    }
  });

  test("an empty query returns nothing", async () => {
    const body = (await (await search(users.owner, "  ")).json()) as SearchResponse;
    expect(body.groups).toEqual([]);
  });

  test("rate limited per user", async () => {
    limiter.reset();
    const tight = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 0.001 });
    const local = startOffice();
    try {
      mountSearchRoutes(local.server.router, {
        auth: local.auth,
        searcher: new Searcher({ db: local.db, canViewOperation: () => false }),
        logger: silent,
        limiter: tight,
      });
      indexerFor(local.db, tmp.dir); // creates the index tables
      const u = await local.signUp("Zed");
      const other = await local.signUp("Yan");
      const get = (c: string) => local.request(`${SEARCH_API_PATH}?q=x`, { cookie: c });
      expect((await get(u.cookie)).status).toBe(200);
      expect((await get(u.cookie)).status).toBe(200);
      const limited = await get(u.cookie);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await get(other.cookie)).status).toBe(200);
    } finally {
      await local.stop();
    }
  });
});
