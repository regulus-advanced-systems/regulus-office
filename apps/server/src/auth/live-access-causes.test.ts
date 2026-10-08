/**
 * Today's causes of lost access reach the live access registry (#244),
 * wired as in index.ts: a person's GitHub permission on the room's repo
 * changed or gone (#270), their member row (a limit on top of it) set and
 * lifted, an operation archived and deleted. (Role changes and sign-out go through the auth
 * routes and are covered over the wire in the whiteboard and terminal
 * live-access integration tests.) The connections here are stand-ins with
 * the real rule, `operationAccessFor`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCESS_CLOSE_CODES, type OperationAccess, type UserRole } from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import { seedRoomMember } from "../github/access/test-snapshot.ts";
import { createLogger } from "../logging.ts";
import { operationIdsOfRepos } from "../operations/access.ts";
import { createOperations, operationAccessFor } from "../operations/index.ts";
import { makeBareRepo, testDb } from "../operations/test-helpers.ts";
import { LiveAccess } from "./live-access.ts";
import { getProfileByUserId } from "./roles.ts";

const logger = createLogger({ level: "silent" });
let root: string;
let remoteBase: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-live-causes-"));
  remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello", "trunk");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function office() {
  const { db, addUser } = testDb();
  const liveAccess = new LiveAccess({
    // These users have no sessions: who they are now is their profile.
    subjects: (id) => {
      const profile = getProfileByUserId(db, id);
      return profile ? { id, role: profile.role } : null;
    },
    logger,
  });
  const operations = createOperations({
    db,
    logger,
    config: {
      projectsDir: join(root, `projects-${crypto.randomUUID().slice(0, 8)}`),
      githubRemoteBase: remoteBase,
    },
    keyring: undefined,
    onChange: (operationId) => liveAccess.accessChanged({ operationIds: [operationId] }),
    onAccessChange: (operationId, userId) =>
      liveAccess.accessChanged({ userId, operationIds: [operationId] }),
  });
  const owner = addUser("Olga", "owner");
  const member = addUser("Mia", "member");
  const other = addUser("Otto", "member");
  const { operation, cloned } = operations.service.create(owner, {
    name: "Apollo",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  /**
   * GitHub now gives the person `access` to the room (null: nothing), and the
   * office hears of it as index.ts wires github/access's `access-changed`.
   */
  const github = (user: { id: string }, access: OperationAccess | null) => {
    const repoId = seedRoomMember(db, user.id, operation.operationId, access);
    liveAccess.accessChanged({ userId: user.id, operationIds: operationIdsOfRepos(db, [repoId]) });
  };
  // The owner administers the repo on GitHub; the two members may push to it.
  github(owner, "manage");
  github(member, "spawn");
  github(other, "spawn");
  return {
    db,
    liveAccess,
    operations,
    github,
    owner,
    member,
    other,
    cloned,
    operationId: operation.operationId,
  };
}

/** A connection that was opened with some access to an operation, like a board socket. */
function connection(
  liveAccess: LiveAccess,
  db: Db,
  user: { id: string; role: UserRole },
  operationId: string,
) {
  const granted: OperationAccess | null = operationAccessFor(db, user, operationId);
  const seen: { closed: number | null } = { closed: null };
  liveAccess.register({
    kind: "test",
    user,
    session: { id: "none" },
    operationId,
    check: (now) => {
      const access = operationAccessFor(db, now, operationId);
      if (!access) return "revoked";
      return access === granted ? "keep" : "changed";
    },
    close: (code) => {
      seen.closed = code;
    },
  });
  return seen;
}

describe("causes of lost access", () => {
  test("a member row narrows a person's access, then is lifted", () => {
    const t = office();
    const svc = t.operations.service;
    const mine = connection(t.liveAccess, t.db, t.member, t.operationId);
    const theirs = connection(t.liveAccess, t.db, t.other, t.operationId);
    const owners = connection(t.liveAccess, t.db, t.owner, t.operationId);

    // Setting the same access again changes nothing for anyone.
    svc.setMember(t.owner, t.operationId, t.member.id, "spawn");
    expect(mine.closed).toBeNull();

    svc.setMember(t.owner, t.operationId, t.member.id, "view");
    expect(mine.closed).toBe(ACCESS_CLOSE_CODES.changed);
    expect(theirs.closed).toBeNull();

    // Lifting the limit gives back what GitHub gives: the connection opened under it is renewed.
    const again = connection(t.liveAccess, t.db, t.member, t.operationId);
    svc.removeMember(t.owner, t.operationId, t.member.id);
    expect(again.closed).toBe(ACCESS_CLOSE_CODES.changed);
    expect(operationAccessFor(t.db, t.member, t.operationId)).toBe("spawn");
    expect(theirs.closed).toBeNull();
    expect(owners.closed).toBeNull();
  });

  test("a person's GitHub permission on the repo is reduced, then gone", () => {
    const t = office();
    const mine = connection(t.liveAccess, t.db, t.member, t.operationId);
    const theirs = connection(t.liveAccess, t.db, t.other, t.operationId);
    const owners = connection(t.liveAccess, t.db, t.owner, t.operationId);

    // A refresh that finds the same permission changes nothing for anyone.
    t.github(t.member, "spawn");
    expect(mine.closed).toBeNull();

    t.github(t.member, "view");
    expect(mine.closed).toBe(ACCESS_CLOSE_CODES.changed);

    const again = connection(t.liveAccess, t.db, t.member, t.operationId);
    t.github(t.member, null);
    expect(again.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(theirs.closed).toBeNull();
    expect(owners.closed).toBeNull();

    // The office owner is no exception: without the repo on GitHub the room closes for them too.
    t.github(t.owner, null);
    expect(owners.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(theirs.closed).toBeNull();
  });

  test("an archived operation closes for everyone, office owner included", () => {
    const t = office();
    const mine = connection(t.liveAccess, t.db, t.member, t.operationId);
    const owners = connection(t.liveAccess, t.db, t.owner, t.operationId);
    t.operations.service.archive(t.owner, t.operationId);
    expect(mine.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(owners.closed).toBe(ACCESS_CLOSE_CODES.revoked);
  });

  test("a deleted operation closes what was opened after a restore", async () => {
    const t = office();
    t.operations.service.archive(t.owner, t.operationId);
    t.operations.lifecycle.restore(t.owner, t.operationId);
    const mine = connection(t.liveAccess, t.db, t.member, t.operationId);
    expect(mine.closed).toBeNull();
    t.operations.service.archive(t.owner, t.operationId);
    expect(mine.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    await t.cloned;
    await t.operations.lifecycle.delete(t.owner, t.operationId, "Apollo");
    expect(t.liveAccess.count({ operationIds: [t.operationId] })).toBe(0);
  });
});
