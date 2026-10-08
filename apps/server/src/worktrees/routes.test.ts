/** `POST /api/worktrees/prune`: owner/admin only, same-origin, audited; answers counts, never paths (#270). */
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
const result: PruneResult = {
  removed: ["/w/apollo/u1/a1"],
  failed: [{ path: "/w/secret-room/u2/a2", reason: "busy: /w/secret-room/u2/a2" }],
  repos: 2,
};

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
    // Counts only: a path names a room's directory, which the office role alone does not show.
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ removed: 1, failed: 1, repos: 2 });
    expect(text).not.toContain("apollo");
    expect(text).not.toContain("secret-room");
    expect(calls).toBe(1);
    const audit = office.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "worktrees.prune"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.userId).toBe(owner.id);
    expect(JSON.parse(audit[0]?.metaJson ?? "{}")).toEqual({ removed: 1, failed: 1, repos: 2 });
  });
});
