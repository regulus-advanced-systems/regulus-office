/**
 * Archive, restore and delete (#150) through `FloorLifecycle`, on real clones
 * and dirs: delete removes only that floor's dirs (never through a symlink),
 * every floor row and its agents, keeps the audit log, and is refused while
 * robots are on the floor.
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
  floorMembers,
  floorRepos,
  floors as floorsTable,
} from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { OfficeFloorDirRemover } from "../worktrees/floor-dirs.ts";
import { createFloors } from "./index.ts";
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
  const floors = createFloors({
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
    const { floor, cloned } = floors.service.create(owner, {
      name,
      tier: "small",
      repos: [{ repo: "octo/hello" }],
    });
    await cloned;
    // A human's area as the worktrees module lays it out: a clone and an agent worktree.
    const area = join(worktreesDir, floor.slug, "u1");
    await mkdir(join(area, "_clones", "hello", ".git"), { recursive: true });
    await Bun.write(join(area, "agent-1", "work.txt"), "work\n");
    return floor;
  };
  return { db, floors, owner, admin, member, projectsDir, worktreesDir, changed, make };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** An agent row on the floor; `seated` also claims a desk (a robot on the floor). */
function addAgent(t: Setup, floorId: string, status: "working" | "exited", seated: boolean) {
  const repo = t.db.select().from(floorRepos).where(eq(floorRepos.floorId, floorId)).get();
  const desk = t.db.select().from(desks).where(eq(desks.floorId, floorId)).get();
  if (!repo || !desk) throw new Error("fixture: no repo or desk");
  const id = randomUUID();
  t.db
    .insert(agents)
    .values({
      id,
      floorId,
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

describe("FloorLifecycle", () => {
  test("only owners and admins archive, restore, list archived, send home and delete", async () => {
    const t = await setup();
    const floor = await t.make("Apollo");
    t.floors.service.setMember(t.owner, floor.floorId, t.member.id, "manage");
    const { lifecycle, service } = t.floors;
    expect(await failure(() => service.archive(t.member, floor.floorId))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await failure(() => lifecycle.listArchived(t.member))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await failure(() => lifecycle.sendAllHome(t.member, floor.floorId))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await failure(() => lifecycle.delete(t.member, floor.floorId, "Apollo"))).toBe(
      "403 owner_or_admin_required",
    );
    service.archive(t.admin, floor.floorId);
    expect(await failure(() => lifecycle.restore(t.member, floor.floorId))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await exists(join(t.projectsDir, "apollo"))).toBe(true);
  });

  test("archive hides the floor and keeps everything; restore brings it back", async () => {
    const t = await setup();
    const floor = await t.make("Apollo");
    t.floors.service.archive(t.owner, floor.floorId);
    expect(t.floors.service.list(t.owner)).toEqual([]);
    expect(t.floors.lifecycle.listArchived(t.admin).map((f) => f.floorId)).toEqual([floor.floorId]);
    expect(await exists(join(t.worktreesDir, "apollo", "u1", "_clones", "hello"))).toBe(true);

    const restored = t.floors.lifecycle.restore(t.admin, floor.floorId);
    expect(restored).toMatchObject({ floorId: floor.floorId, archivedAt: null, slug: "apollo" });
    expect(t.floors.service.list(t.owner).map((f) => f.floorId)).toEqual([floor.floorId]);
    expect(t.floors.lifecycle.listArchived(t.admin)).toEqual([]);
    expect(await failure(() => t.floors.lifecycle.restore(t.admin, floor.floorId))).toBe(
      "409 floor_not_archived",
    );
    const actions = t.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.targetId, floor.floorId))
      .all()
      .map((a) => a.action);
    expect(actions).toEqual(["floor.create", "floor.archive", "floor.restore"]);
    expect(t.changed.filter((id) => id === floor.floorId).length).toBeGreaterThanOrEqual(3);
  });

  test("delete is refused while robots are on the floor, with the list", async () => {
    const t = await setup();
    const floor = await t.make("Apollo");
    const working = addAgent(t, floor.floorId, "working", true);
    let body: Record<string, unknown> = {};
    try {
      await t.floors.lifecycle.delete(t.owner, floor.floorId, "Apollo");
    } catch (err) {
      if (!(err instanceof AuthHttpError)) throw err;
      expect([err.status, err.code]).toEqual([409, "floor_has_robots"]);
      body = err.detail;
    }
    expect(body.robots).toEqual([
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
    expect(t.floors.service.list(t.owner)).toHaveLength(1);
    expect(await exists(join(t.projectsDir, "apollo"))).toBe(true);
  });

  test("send all home uses the manager for every robot and reports failures", async () => {
    const t = await setup();
    const floor = await t.make("Apollo");
    const a = addAgent(t, floor.floorId, "exited", true);
    const b = addAgent(t, floor.floorId, "working", false);
    expect(await failure(() => t.floors.lifecycle.sendAllHome(t.owner, floor.floorId))).toBe(
      "503 robots_unavailable",
    );
    const sent: string[] = [];
    t.floors.lifecycle.robots = {
      sendHome: async (_actor, agentId) => {
        if (agentId === b) throw new Error("the agent is gone");
        sent.push(agentId);
        t.db.update(desks).set({ agentId: null }).where(eq(desks.agentId, agentId)).run();
      },
    };
    const result = await t.floors.lifecycle.sendAllHome(t.admin, floor.floorId);
    expect(result).toEqual({ sentHome: 1, failed: [{ agentId: b, reason: "the agent is gone" }] });
    expect(sent).toEqual([a]);
  });

  test("delete needs the floor's name typed", async () => {
    const t = await setup();
    const floor = await t.make("Apollo");
    expect(await failure(() => t.floors.lifecycle.delete(t.owner, floor.floorId, "apollo"))).toBe(
      "400 confirm_name_mismatch",
    );
    expect(await failure(() => t.floors.lifecycle.delete(t.owner, "nope", "Apollo"))).toBe(
      "404 floor_not_found",
    );
  });

  test("delete removes only that floor's dirs and rows, keeps the audit log", async () => {
    const t = await setup();
    const doomed = await t.make("Apollo");
    const kept = await t.make("Hermes");
    // History on the doomed floor: a sent-home agent (no desk, exited) and a member.
    addAgent(t, doomed.floorId, "exited", false);
    t.floors.service.setMember(t.owner, doomed.floorId, t.member.id, "spawn");
    t.db
      .insert(chatMessages)
      .values([
        {
          userId: t.member.id,
          displayName: "Mia",
          floorId: doomed.floorId,
          text: "hi",
          ts: new Date(),
        },
        { userId: t.member.id, displayName: "Mia", floorId: "", text: "lobby", ts: new Date() },
      ])
      .run();
    // Symlinks out of the doomed floor into the kept one and outside the roots.
    const outside = join(root, `outside-${randomUUID()}.txt`);
    await Bun.write(outside, "keep\n");
    const keptArea = join(t.worktreesDir, "hermes", "u1");
    await symlink(keptArea, join(t.worktreesDir, "apollo", "u1", "to-hermes"));
    await symlink(outside, join(t.worktreesDir, "apollo", "u1", "agent-1", "outside"));
    await symlink(join(t.projectsDir, "hermes"), join(t.projectsDir, "apollo", "to-hermes"));

    const removed = await t.floors.lifecycle.delete(t.owner, doomed.floorId, " Apollo ");
    expect(removed).toEqual([join(t.projectsDir, "apollo"), join(t.worktreesDir, "apollo")]);
    expect(await exists(join(t.projectsDir, "apollo"))).toBe(false);
    expect(await exists(join(t.worktreesDir, "apollo"))).toBe(false);
    expect(await readFile(outside, "utf8")).toBe("keep\n");
    expect(await readFile(join(keptArea, "agent-1", "work.txt"), "utf8")).toBe("work\n");
    expect(await exists(join(t.projectsDir, "hermes", "hello", ".git"))).toBe(true);

    const on = (table: typeof floorRepos | typeof floorMembers | typeof desks | typeof agents) =>
      t.db.select().from(table).where(eq(table.floorId, doomed.floorId)).all();
    expect(t.db.select().from(floorsTable).where(eq(floorsTable.id, doomed.floorId)).get()).toBe(
      undefined,
    );
    for (const table of [floorRepos, floorMembers, desks, agents]) expect(on(table)).toEqual([]);
    expect(t.db.select().from(agentEvents).all()).toEqual([]);
    expect(t.db.select({ text: chatMessages.text }).from(chatMessages).all()).toEqual([
      { text: "lobby" },
    ]);
    expect(t.floors.service.list(t.owner).map((f) => f.floorId)).toEqual([kept.floorId]);
    const audit = t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, doomed.floorId), eq(auditLog.action, "floor.delete")))
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

  test("files that cannot be removed leave the floor archived, rows kept, retryable", async () => {
    const t = await setup();
    const floor = await t.make("Apollo");
    const failing = createFloors({
      db: t.db,
      logger,
      config: { projectsDir: t.projectsDir, githubRemoteBase: remoteBase },
      keyring: undefined,
      dirs: {
        removeFloorDirs: async () => {
          throw new Error("permission denied");
        },
      },
    });
    expect(await failure(() => failing.lifecycle.delete(t.owner, floor.floorId, "Apollo"))).toBe(
      "500 floor_files_not_removed",
    );
    expect(failing.lifecycle.listArchived(t.owner).map((f) => f.floorId)).toEqual([floor.floorId]);
    // Retried from Settings → Floors with a working remover.
    await t.floors.lifecycle.delete(t.owner, floor.floorId, "Apollo");
    expect(t.floors.lifecycle.listArchived(t.owner)).toEqual([]);
  });
});

describe("OfficeFloorDirRemover", () => {
  test("refuses a floor dir that is a symlink and anything that is not a slug", async () => {
    const base = join(root, `remover-${randomUUID()}`);
    const target = join(base, "elsewhere");
    await mkdir(join(target, "inner"), { recursive: true });
    await mkdir(join(base, "projects"), { recursive: true });
    await symlink(target, join(base, "projects", "evil"));
    const remover = new OfficeFloorDirRemover([join(base, "projects")]);
    await expect(remover.removeFloorDirs("evil")).rejects.toThrow("not a directory");
    for (const slug of ["", ".", "..", "a/b", "../elsewhere", "-x", "X"]) {
      await expect(remover.removeFloorDirs(slug)).rejects.toThrow("invalid floor slug");
    }
    expect(await exists(join(target, "inner"))).toBe(true);
    // A missing floor dir or root is nothing to do.
    expect(await remover.removeFloorDirs("absent")).toEqual([]);
    expect(await new OfficeFloorDirRemover([join(base, "no-root")]).removeFloorDirs("x")).toEqual(
      [],
    );
  });
});
