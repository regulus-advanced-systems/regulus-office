/** `POST /api/worktrees/prune`: owner/admin only, same-origin, audited. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { auditLog } from "../db/schema/index.ts";
import type { PruneResult } from "./prune.ts";
import { mountWorktreeRoutes, WORKTREES_PRUNE_PATH } from "./routes.ts";

let office: Office;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let calls = 0;
const result: PruneResult = { removed: ["/w/f/a1"], failed: [], repos: 2 };

beforeAll(async () => {
  office = startOffice();
  mountWorktreeRoutes(office.server.router, {
    auth: office.auth,
    db: office.db,
    prune: async () => {
      calls += 1;
      return result;
    },
  });
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
});

afterAll(async () => {
  await office.stop();
});

const prune = (cookie?: string, origin?: string) =>
  office.request(WORKTREES_PRUNE_PATH, {
    method: "POST",
    cookie,
    headers: origin ? { origin } : undefined,
  });

describe("prune route", () => {
  test("anonymous 401, members 403, cross-origin 403; nothing runs", async () => {
    expect((await prune()).status).toBe(401);
    expect((await prune(member.cookie)).status).toBe(403);
    expect((await prune(owner.cookie, "https://evil.example")).status).toBe(403);
    expect(calls).toBe(0);
  });

  test("owners prune and the action is audited", async () => {
    const res = await prune(owner.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(calls).toBe(1);
    const audit = office.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "worktrees.prune"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.userId).toBe(owner.id);
  });
});
