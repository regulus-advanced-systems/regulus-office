/**
 * Archive, restore and delete (#150) through `OperationLifecycle`, on real clones
 * and dirs: delete removes only that operation's dirs (never through a symlink),
 * every operation row and its agents, keeps the audit log, and is refused while
 * henchmen are on the operation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { AuthHttpError } from "../auth/errors.ts";
import {
  agentEvents,
  agents,
  auditLog,
  chatMessages,
  desks,
  operationMembers,
  operationRepos,
  operations as operationsTable,
} from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { OfficeOperationDirRemover } from "../worktrees/operation-dirs.ts";
import { createOperations } from "./index.ts";
import { makeBareRepo, testDb } from "./test-helpers.ts";

const logger = createLogger({ level: "silent" });
let root: string;
let remoteBase: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rg150-lifecycle-"));
  remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello", "trunk");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setup() {
  const { db, addUser } = testDb();
  const base = join(root, randomUUID().slice(0, 8));
  const projectsDir = join(base, "projects");
  const worktreesDir = join(base, "worktrees");
  const changed: string[] = [];
  const operations = createOperations({
    db,
    logger,
    config: { projectsDir, worktreesDir, githubRemoteBase: remoteBase },
    keyring: undefined,
    onChange: (id) => changed.push(id),
  });
  const owner = addUser("Olga", "owner");
  const admin = addUser("Adam", "admin");
  const member = addUser("Mia", "member");
  const make = async (name: string) => {
    const { operation, cloned } = operations.service.create(owner, {
      name,
      tier: "small",
      repos: [{ repo: "octo/hello" }],
    });
    await cloned;
    // A human's area as the worktrees module lays it out: a clone and an agent worktree.
    const area = join(worktreesDir, operation.slug, "u1");
    await mkdir(join(area, "_clones", "hello", ".git"), { recursive: true });
    await Bun.write(join(area, "agent-1", "work.txt"), "work\n");
    return operation;
  };
  return { db, operations, owner, admin, member, projectsDir, worktreesDir, changed, make };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** An agent row on the operation; `seated` also claims a desk (a henchman on the operation). */
function addAgent(t: Setup, operationId: string, status: "working" | "exited", seated: boolean) {
  const repo = t.db
    .select()
    .from(operationRepos)
    .where(eq(operationRepos.operationId, operationId))
    .get();
  const desk = t.db.select().from(desks).where(eq(desks.operationId, operationId)).get();
  if (!repo || !desk) throw new Error("fixture: no repo or desk");
  const id = randomUUID();
  t.db
    .insert(agents)
    .values({
      id,
      operationId,
      repoId: repo.id,
      deskSeatId: desk.seatId,
      ownerUserId: t.member.id,
      provider: "claude-code",
      model: "opus",
      profileId: "login:claude",
      status,
      workdir: "/nowhere",
      taskTitle: "Fix the flux capacitor",
    })
    .run();
  t.db
    .insert(agentEvents)
    .values({ agentId: id, ts: new Date(), kind: "status", payloadJson: "{}" })
    .run();
  if (seated) t.db.update(desks).set({ agentId: id }).where(eq(desks.id, desk.id)).run();
  return id;
}

const failure = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AuthHttpError) return `${err.status} ${err.code}`;
    throw err;
  }
  return "ok";
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("OperationLifecycle", () => {
  test("only owners and admins archive, restore, list archived, send home and delete", async () => {
    const t = await setup();
    const operation = await t.make("Apollo");
    t.operations.service.setMember(t.owner, operation.operationId, t.member.id, "manage");
    const { lifecycle, service } = t.operations;
    expect(await failure(() => service.archive(t.member, operation.operationId))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await failure(() => lifecycle.listArchived(t.member))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await failure(() => lifecycle.sendAllHome(t.member, operation.operationId))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await failure(() => lifecycle.delete(t.member, operation.operationId, "Apollo"))).toBe(
      "403 owner_or_admin_required",
    );
    service.archive(t.admin, operation.operationId);
    expect(await failure(() => lifecycle.restore(t.member, operation.operationId))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await exists(join(t.projectsDir, "apollo"))).toBe(true);
  });

  test("archive hides the operation and keeps everything; restore brings it back", async () => {
    const t = await setup();
    const operation = await t.make("Apollo");
    t.operations.service.archive(t.owner, operation.operationId);
    expect(t.operations.service.list(t.owner)).toEqual([]);
    expect(t.operations.lifecycle.listArchived(t.admin).map((f) => f.operationId)).toEqual([
      operation.operationId,
    ]);
    expect(await exists(join(t.worktreesDir, "apollo", "u1", "_clones", "hello"))).toBe(true);

    const restored = t.operations.lifecycle.restore(t.admin, operation.operationId);
    expect(restored).toMatchObject({
      operationId: operation.operationId,
      archivedAt: null,
      slug: "apollo",
    });
    expect(t.operations.service.list(t.owner).map((f) => f.operationId)).toEqual([
      operation.operationId,
    ]);
    expect(t.operations.lifecycle.listArchived(t.admin)).toEqual([]);
    expect(
      await failure(() => t.operations.lifecycle.restore(t.admin, operation.operationId)),
    ).toBe("409 operation_not_archived");
    const actions = t.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.targetId, operation.operationId))
      .all()
      .map((a) => a.action);
    expect(actions).toEqual(["operation.create", "operation.archive", "operation.restore"]);
    expect(t.changed.filter((id) => id === operation.operationId).length).toBeGreaterThanOrEqual(3);
  });

  test("delete is refused while henchmen are on the operation, with the list", async () => {
    const t = await setup();
    const operation = await t.make("Apollo");
    const working = addAgent(t, operation.operationId, "working", true);
    let body: Record<string, unknown> = {};
    try {
      await t.operations.lifecycle.delete(t.owner, operation.operationId, "Apollo");
    } catch (err) {
      if (!(err instanceof AuthHttpError)) throw err;
      expect([err.status, err.code]).toEqual([409, "operation_has_henchmen"]);
      body = err.detail;
    }
    expect(body.henchmen).toEqual([
      {
        agentId: working,
        ownerUserId: t.member.id,
        ownerName: "Mia",
        status: "working",
        taskTitle: "Fix the flux capacitor",
        running: true,
      },
    ]);
    // Nothing happened: not archived, files and rows kept.
    expect(t.operations.service.list(t.owner)).toHaveLength(1);
    expect(await exists(join(t.projectsDir, "apollo"))).toBe(true);
  });

  test("send all home uses the manager for every henchman and reports failures", async () => {
    const t = await setup();
    const operation = await t.make("Apollo");
    const a = addAgent(t, operation.operationId, "exited", true);
    const b = addAgent(t, operation.operationId, "working", false);
    expect(
      await failure(() => t.operations.lifecycle.sendAllHome(t.owner, operation.operationId)),
    ).toBe("503 henchmen_unavailable");
    const sent: string[] = [];
    t.operations.lifecycle.henchmen = {
      sendHome: async (_actor, agentId) => {
        if (agentId === b) throw new Error("the agent is gone");
        sent.push(agentId);
        t.db.update(desks).set({ agentId: null }).where(eq(desks.agentId, agentId)).run();
      },
    };
    const result = await t.operations.lifecycle.sendAllHome(t.admin, operation.operationId);
    expect(result).toEqual({ sentHome: 1, failed: [{ agentId: b, reason: "the agent is gone" }] });
    expect(sent).toEqual([a]);
  });

  test("delete needs the operation's name typed", async () => {
    const t = await setup();
    const operation = await t.make("Apollo");
    expect(
      await failure(() => t.operations.lifecycle.delete(t.owner, operation.operationId, "apollo")),
    ).toBe("400 confirm_name_mismatch");
    expect(await failure(() => t.operations.lifecycle.delete(t.owner, "nope", "Apollo"))).toBe(
      "404 operation_not_found",
    );
  });

  test("delete removes only that operation's dirs and rows, keeps the audit log", async () => {
    const t = await setup();
    const doomed = await t.make("Apollo");
    const kept = await t.make("Hermes");
    // History on the doomed operation: a sent-home agent (no desk, exited) and a member.
    addAgent(t, doomed.operationId, "exited", false);
    t.operations.service.setMember(t.owner, doomed.operationId, t.member.id, "spawn");
    t.db
      .insert(chatMessages)
      .values([
        {
          userId: t.member.id,
          displayName: "Mia",
          operationId: doomed.operationId,
          text: "hi",
          ts: new Date(),
        },
        { userId: t.member.id, displayName: "Mia", operationId: "", text: "lobby", ts: new Date() },
      ])
      .run();
    // Symlinks out of the doomed operation into the kept one and outside the roots.
    const outside = join(root, `outside-${randomUUID()}.txt`);
    await Bun.write(outside, "keep\n");
    const keptArea = join(t.worktreesDir, "hermes", "u1");
    await symlink(keptArea, join(t.worktreesDir, "apollo", "u1", "to-hermes"));
    await symlink(outside, join(t.worktreesDir, "apollo", "u1", "agent-1", "outside"));
    await symlink(join(t.projectsDir, "hermes"), join(t.projectsDir, "apollo", "to-hermes"));

    const removed = await t.operations.lifecycle.delete(t.owner, doomed.operationId, " Apollo ");
    expect(removed).toEqual([join(t.projectsDir, "apollo"), join(t.worktreesDir, "apollo")]);
    expect(await exists(join(t.projectsDir, "apollo"))).toBe(false);
    expect(await exists(join(t.worktreesDir, "apollo"))).toBe(false);
    expect(await readFile(outside, "utf8")).toBe("keep\n");
    expect(await readFile(join(keptArea, "agent-1", "work.txt"), "utf8")).toBe("work\n");
    expect(await exists(join(t.projectsDir, "hermes", "hello", ".git"))).toBe(true);

    const on = (
      table: typeof operationRepos | typeof operationMembers | typeof desks | typeof agents,
    ) => t.db.select().from(table).where(eq(table.operationId, doomed.operationId)).all();
    expect(
      t.db.select().from(operationsTable).where(eq(operationsTable.id, doomed.operationId)).get(),
    ).toBe(undefined);
    for (const table of [operationRepos, operationMembers, desks, agents])
      expect(on(table)).toEqual([]);
    expect(t.db.select().from(agentEvents).all()).toEqual([]);
    expect(t.db.select({ text: chatMessages.text }).from(chatMessages).all()).toEqual([
      { text: "lobby" },
    ]);
    expect(t.operations.service.list(t.owner).map((f) => f.operationId)).toEqual([
      kept.operationId,
    ]);
    const audit = t.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.targetId, doomed.operationId), eq(auditLog.action, "operation.delete")),
      )
      .get();
    expect(JSON.parse(audit?.metaJson ?? "{}")).toMatchObject({
      name: "Apollo",
      slug: "apollo",
      repos: ["octo/hello"],
      ok: true,
    });
    // The slug is free again.
    expect((await t.make("Apollo")).slug).toBe("apollo");
  });

  test("a room that shares its directories with another keeps them when it is deleted (#268)", async () => {
    const t = await setup();
    const original = await t.make("Apollo");
    const sibling = await t.make("Apollo api");
    // As the split leaves it: the sibling's files live in the original's directories.
    t.db
      .update(operationsTable)
      .set({ dirSlug: "apollo" })
      .where(eq(operationsTable.id, sibling.operationId))
      .run();
    // A new operation never takes a directory name that is in use, even with its slug free.
    t.db
      .update(operationsTable)
      .set({ slug: "renamed" })
      .where(eq(operationsTable.id, original.operationId))
      .run();
    t.db
      .update(operationsTable)
      .set({ dirSlug: "apollo" })
      .where(eq(operationsTable.id, original.operationId))
      .run();
    expect((await t.make("Apollo")).slug).toBe("apollo-2");

    expect(await t.operations.lifecycle.delete(t.owner, original.operationId, "Apollo")).toEqual(
      [],
    );
    expect(await exists(join(t.projectsDir, "apollo", "hello", ".git"))).toBe(true);
    expect(
      await readFile(join(t.worktreesDir, "apollo", "u1", "agent-1", "work.txt"), "utf8"),
    ).toBe("work\n");
    const audit = t.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.targetId, original.operationId), eq(auditLog.action, "operation.delete")),
      )
      .get();
    expect(JSON.parse(audit?.metaJson ?? "{}")).toMatchObject({
      ok: true,
      removed: [],
      filesKept: "apollo",
      sharedWith: [sibling.operationId],
    });
    // The last room using the directories takes them along.
    expect(await t.operations.lifecycle.delete(t.owner, sibling.operationId, "Apollo api")).toEqual(
      [join(t.projectsDir, "apollo"), join(t.worktreesDir, "apollo")],
    );
    expect(await exists(join(t.projectsDir, "apollo"))).toBe(false);
    // The sibling's own (unused) directories, made by the fixture, are not its files: untouched.
    expect(await exists(join(t.projectsDir, "apollo-api"))).toBe(true);
  });

  test("files that cannot be removed leave the operation archived, rows kept, retryable", async () => {
    const t = await setup();
    const operation = await t.make("Apollo");
    const failing = createOperations({
      db: t.db,
      logger,
      config: { projectsDir: t.projectsDir, githubRemoteBase: remoteBase },
      keyring: undefined,
      dirs: {
        removeOperationDirs: async () => {
          throw new Error("permission denied");
        },
      },
    });
    expect(
      await failure(() => failing.lifecycle.delete(t.owner, operation.operationId, "Apollo")),
    ).toBe("500 operation_files_not_removed");
    expect(failing.lifecycle.listArchived(t.owner).map((f) => f.operationId)).toEqual([
      operation.operationId,
    ]);
    // Retried from Settings → Operations with a working remover.
    await t.operations.lifecycle.delete(t.owner, operation.operationId, "Apollo");
    expect(t.operations.lifecycle.listArchived(t.owner)).toEqual([]);
  });
});

describe("OfficeOperationDirRemover", () => {
  test("refuses an operation dir that is a symlink and anything that is not a slug", async () => {
    const base = join(root, `remover-${randomUUID()}`);
    const target = join(base, "elsewhere");
    await mkdir(join(target, "inner"), { recursive: true });
    await mkdir(join(base, "projects"), { recursive: true });
    await symlink(target, join(base, "projects", "evil"));
    const remover = new OfficeOperationDirRemover([join(base, "projects")]);
    await expect(remover.removeOperationDirs("evil")).rejects.toThrow("not a directory");
    for (const slug of ["", ".", "..", "a/b", "../elsewhere", "-x", "X"]) {
      await expect(remover.removeOperationDirs(slug)).rejects.toThrow("invalid operation slug");
    }
    expect(await exists(join(target, "inner"))).toBe(true);
    // A missing operation dir or root is nothing to do.
    expect(await remover.removeOperationDirs("absent")).toEqual([]);
    expect(
      await new OfficeOperationDirRemover([join(base, "no-root")]).removeOperationDirs("x"),
    ).toEqual([]);
  });
});
