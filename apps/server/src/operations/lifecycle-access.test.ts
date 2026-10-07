/**
 * Archive, restore, send home and delete need the office role AND the actor's
 * own GitHub access to the room's repo (D27; #270): an office owner or admin
 * whose account cannot see the repo is told the room is not there.
 */
import { describe, expect, test } from "bun:test";
import { AuthHttpError } from "../auth/errors.ts";
import { operations as operationsTable } from "../db/schema/index.ts";
import { seedGitHubLink, seedRoomMember } from "../github/access/test-snapshot.ts";
import { createLogger } from "../logging.ts";
import { createOperations } from "./index.ts";
import { testDb } from "./test-helpers.ts";

/** Two rooms: the owner's GitHub account administers both repos, the admin's reads only the first. */
async function setup() {
  const { db, addUser } = testDb();
  const removedDirs: string[] = [];
  const { service, lifecycle } = createOperations({
    db,
    logger: createLogger({ level: "silent" }),
    // Nothing to clone from: these tests are about who is answered, not about files.
    config: { projectsDir: "/nonexistent/rg270/projects", githubRemoteBase: "file:///nonexistent" },
    keyring: undefined,
    dirs: {
      removeOperationDirs: async (slug) => {
        removedDirs.push(slug);
        return [];
      },
    },
  });
  const owner = addUser("Olga", "owner");
  const admin = addUser("Adam", "admin");
  const member = addUser("Mia", "member");
  for (const user of [owner, admin, member]) seedGitHubLink(db, user.id);
  const make = async (name: string, repo: string) => {
    const made = service.create(owner, { name, tier: "small", repos: [{ repo }] }, undefined, "admin");
    await made.cloned;
    return made.operation;
  };
  const seen = await make("Apollo", "octo/hello");
  const unseen = await make("Hermes", "secret/plans");
  seedRoomMember(db, admin.id, seen.operationId, "view");
  return { db, service, lifecycle, owner, admin, member, seen, unseen, removedDirs };
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

describe("OperationLifecycle and GitHub access", () => {
  test("a live room of a repo the office admin cannot see is not found", async () => {
    const t = await setup();
    const id = t.unseen.operationId;
    t.lifecycle.henchmen = { sendHome: async () => undefined };
    expect(await failure(() => t.service.archive(t.admin, id))).toBe("404 operation_not_found");
    expect(await failure(() => t.lifecycle.sendAllHome(t.admin, id))).toBe(
      "404 operation_not_found",
    );
    expect(await failure(() => t.lifecycle.delete(t.admin, id, "Hermes"))).toBe(
      "404 operation_not_found",
    );
    expect(t.service.list(t.owner).map((o) => o.name)).toEqual(["Apollo", "Hermes"]);
    expect(t.removedDirs).toEqual([]);
    // With read access to the repo the same admin may do all of it.
    expect(await t.lifecycle.sendAllHome(t.admin, t.seen.operationId)).toEqual({
      sentHome: 0,
      failed: [],
    });
    t.service.archive(t.admin, t.seen.operationId);
    expect(t.service.list(t.owner).map((o) => o.name)).toEqual(["Hermes"]);
  });

  test("the archive lists, restores and deletes only rooms of repos the actor can see", async () => {
    const t = await setup();
    t.service.archive(t.owner, t.seen.operationId);
    t.service.archive(t.owner, t.unseen.operationId);
    expect(t.lifecycle.listArchived(t.owner).map((o) => o.name).sort()).toEqual([
      "Apollo",
      "Hermes",
    ]);
    expect(t.lifecycle.listArchived(t.admin).map((o) => o.name)).toEqual(["Apollo"]);
    const id = t.unseen.operationId;
    expect(await failure(() => t.lifecycle.restore(t.admin, id))).toBe("404 operation_not_found");
    expect(await failure(() => t.lifecycle.delete(t.admin, id, "Hermes"))).toBe(
      "404 operation_not_found",
    );
    expect(t.db.select().from(operationsTable).all()).toHaveLength(2);
    expect(t.removedDirs).toEqual([]);

    expect(t.lifecycle.restore(t.admin, t.seen.operationId)).toMatchObject({
      name: "Apollo",
      archivedAt: null,
      access: "view",
    });
    await t.lifecycle.delete(t.admin, t.seen.operationId, "Apollo");
    expect(t.db.select({ name: operationsTable.name }).from(operationsTable).all()).toEqual([
      { name: "Hermes" },
    ]);
  });

  test("an office owner with no linked GitHub account sees no archived room either", async () => {
    const t = await setup();
    const unlinked = { id: "user-unlinked", role: "owner" as const };
    t.service.archive(t.owner, t.seen.operationId);
    expect(t.lifecycle.listArchived(unlinked)).toEqual([]);
    expect(await failure(() => t.lifecycle.restore(unlinked, t.seen.operationId))).toBe(
      "404 operation_not_found",
    );
    // GitHub access without the office role is still not enough.
    seedRoomMember(t.db, t.member.id, t.seen.operationId, "manage");
    expect(await failure(() => t.lifecycle.listArchived(t.member))).toBe(
      "403 owner_or_admin_required",
    );
    expect(await failure(() => t.lifecycle.restore(t.member, t.seen.operationId))).toBe(
      "403 owner_or_admin_required",
    );
  });
});
