/**
 * The changes window routes over HTTP with real sessions: who may view
 * (everyone who sees the operation), who may commit and discard (the henchman's
 * owner only, D12), same-origin writes, audit entries, error shapes and the
 * image response headers. The service is a double; changes.integration.test.ts
 * runs the real one against a worktree.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { UserRole } from "@regulus/protocol";
import { changesPath } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import {
  agents,
  auditLog,
  operationMembers,
  operationRepos,
  operations,
  userProfiles,
} from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { ChangesHttpError } from "./paths.ts";
import { mountChangesRoutes } from "./routes.ts";
import type { AgentRow, ChangesService } from "./service.ts";

type User = { id: string; cookie: string };
let office: Office;
let officeOwner: User;
let admin: User;
let henchmanOwner: User;
let member: User;
let viewer: User;
let outsider: User;
let viewerOwner: User;
const writes: string[] = [];
let failNext: ChangesHttpError | null = null;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const fake = {
  agent(id: string) {
    return (office.db.select().from(agents).where(eq(agents.id, id)).get() ??
      null) as AgentRow | null;
  },
  async look() {
    return {
      baseSha: "b".repeat(40),
      byPath: new Map(),
      snapshot: {
        branch: "office/x",
        head: "h".repeat(40),
        base: { ref: "origin/main", sha: "b".repeat(40) },
        ahead: 1,
        files: [],
        truncated: false,
        polledAt: 1,
      },
    };
  },
  async fileDiff(_row: AgentRow, path: string) {
    return {
      path,
      kind: "modified",
      binary: false,
      symlink: false,
      tooLarge: false,
      truncated: false,
      hunks: [],
      image: null,
    };
  },
  async image() {
    return { bytes: PNG, type: "image/png" };
  },
  async commit(row: AgentRow) {
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
    writes.push(`commit:${row.id}`);
    return { sha: "c".repeat(40), files: 2 };
  },
  async discard(row: AgentRow) {
    writes.push(`discard:${row.id}`);
  },
};

async function user(name: string, role?: UserRole): Promise<User> {
  const u = await office.signUp(name);
  if (role) office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, u.id)).run();
  return u;
}

beforeAll(async () => {
  office = startOffice();
  mountChangesRoutes(office.server.router, {
    auth: office.auth,
    db: office.db,
    changes: fake as unknown as ChangesService,
    logger: createLogger({ level: "silent" }),
  });
  officeOwner = await user("Olga"); // first sign-up: office owner
  admin = await user("Ada", "admin");
  henchmanOwner = await user("Rob", "member");
  member = await user("Mia", "member");
  viewer = await user("Vic", "viewer");
  outsider = await user("Otto", "member");
  viewerOwner = await user("Val", "viewer");
  const db = office.db;
  db.insert(operations)
    .values({ id: "f1", name: "F1", slug: "f1", index: 1, paletteId: "p", layoutTemplateId: "t" })
    .run();
  db.insert(operationRepos)
    .values({
      id: "r1",
      operationId: "f1",
      owner: "o",
      name: "r",
      url: "https://example.invalid",
      workdir: "/tmp",
    })
    .run();
  for (const [u, access] of [
    [henchmanOwner, "spawn"],
    [member, "spawn"],
    [viewer, "view"],
    [viewerOwner, "view"],
  ] as const) {
    db.insert(operationMembers).values({ operationId: "f1", userId: u.id, access }).run();
  }
  for (const [id, owner] of [
    ["a1", henchmanOwner],
    ["a2", viewerOwner],
  ] as const) {
    db.insert(agents)
      .values({
        id,
        operationId: "f1",
        repoId: "r1",
        deskSeatId: `s-${id}`,
        ownerUserId: owner.id,
        provider: "custom",
        model: "m",
        profileId: "p",
        workdir: "/tmp",
        taskTitle: "t",
      })
      .run();
  }
});

afterAll(async () => {
  await office.stop();
});

const get = (path: string, u?: User) => office.request(path, { cookie: u?.cookie });
const post = (path: string, body: unknown, u?: User, origin?: string) =>
  office.post(path, body, { cookie: u?.cookie, origin });
const commitBody = { message: "Fix it", files: [{ path: "a.txt", sig: "1:2:3:4" }] };

describe("viewing", () => {
  test("everyone who sees the operation views; only the henchman's owner gets canWrite", async () => {
    for (const [u, canWrite] of [
      [henchmanOwner, true],
      [member, false],
      [viewer, false],
      [admin, false],
      [officeOwner, false],
    ] as const) {
      const res = await get(changesPath("a1"), u);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { canWrite: boolean; agentId: string };
      expect(body.agentId).toBe("a1");
      expect(body.canWrite).toBe(canWrite);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("outside the operation the henchman does not exist; anonymous is 401", async () => {
    expect((await get(changesPath("a1"), outsider)).status).toBe(404);
    expect((await get(`${changesPath("a1", "file")}?path=a.txt`, outsider)).status).toBe(404);
    expect((await get(changesPath("nope"), henchmanOwner)).status).toBe(404);
    expect((await get(changesPath("a1"))).status).toBe(401);
  });

  test("a file diff for any operation viewer", async () => {
    const res = await get(
      `${changesPath("a1", "file")}?path=${encodeURIComponent("a b.txt")}`,
      viewer,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: string }).path).toBe("a b.txt");
  });

  test("image bytes are an inert download: octet-stream, nosniff, sandbox CSP", async () => {
    const res = await get(`${changesPath("a1", "blob")}?path=x.png&side=work`, member);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-image-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    const bad = await get(`${changesPath("a1", "blob")}?path=x.png&side=other`, member);
    expect(bad.status).toBe(400);
  });
});

describe("writing (D12: the henchman's owner only)", () => {
  test("office owner, admin, other members, viewers and a viewer who owns the henchman are refused", async () => {
    for (const [u, agentId, status] of [
      [officeOwner, "a1", 403],
      [admin, "a1", 403],
      [member, "a1", 403],
      [viewer, "a1", 403],
      [viewerOwner, "a2", 403],
      [outsider, "a1", 404],
    ] as const) {
      const c = await post(changesPath(agentId, "commit"), commitBody, u);
      expect(c.status).toBe(status);
      const d = await post(changesPath(agentId, "discard"), { path: "a.txt", sig: null }, u);
      expect(d.status).toBe(status);
      if (status === 403) expect(((await d.json()) as { error: string }).error).toBe("owner_only");
    }
    expect((await post(changesPath("a1", "commit"), commitBody)).status).toBe(401);
    expect(writes).toEqual([]);
  });

  test("cross-origin writes are refused before anything runs", async () => {
    const res = await post(
      changesPath("a1", "commit"),
      commitBody,
      henchmanOwner,
      "https://evil.example",
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("origin_mismatch");
    expect(writes).toEqual([]);
  });

  test("invalid bodies are 400", async () => {
    expect(
      (await post(changesPath("a1", "commit"), { message: "", files: [] }, henchmanOwner)).status,
    ).toBe(400);
    expect((await post(changesPath("a1", "discard"), { sig: null }, henchmanOwner)).status).toBe(
      400,
    );
  });

  test("the owner commits and discards; both are audited without contents", async () => {
    const c = await post(changesPath("a1", "commit"), commitBody, henchmanOwner);
    expect(c.status).toBe(200);
    expect(await c.json()).toEqual({ sha: "c".repeat(40), files: 2 });
    const d = await post(
      changesPath("a1", "discard"),
      { path: "a.txt", sig: "1:2:3:4" },
      henchmanOwner,
    );
    expect(d.status).toBe(200);
    expect(await d.json()).toEqual({ discarded: "a.txt" });
    expect(writes).toEqual(["commit:a1", "discard:a1"]);
    const audit = office.db.select().from(auditLog).all();
    const commit = audit.find((a) => a.action === "agent.changes_commit");
    const discard = audit.find((a) => a.action === "agent.changes_discard");
    expect(commit?.userId).toBe(henchmanOwner.id);
    expect(commit?.targetId).toBe("a1");
    expect(commit?.metaJson).not.toContain("Fix it");
    expect(JSON.parse(discard?.metaJson ?? "{}")).toEqual({ path: "a.txt" });
  });

  test("a conflict is reported with its files, not forced", async () => {
    failNext = new ChangesHttpError(409, "changed_since_viewed", "changed", ["a.txt"]);
    const res = await post(changesPath("a1", "commit"), commitBody, henchmanOwner);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "changed_since_viewed",
      message: "changed",
      files: ["a.txt"],
    });
  });
});
