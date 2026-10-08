/**
 * `GET /api/users` ACL over a real server: only operation managers list people;
 * emails for admins only. A room is managed through one's own GitHub permission
 * on its repo (#270); a member row alone manages nothing.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OfficeUsersResponse, OperationAccess, UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { operationMembers, userProfiles } from "../db/schema/index.ts";
import { seedGitHubLink, seedRoomMember } from "../github/access/test-snapshot.ts";
import { createLogger } from "../logging.ts";
import { createOperations, mountOperationRoutes, type Operations } from "./index.ts";
import { makeBareRepo } from "./test-helpers.ts";

type Who = { id: string; email: string; cookie: string };

let root: string;
let office: Office;
let operations: Operations;
let owner: Who;
let admin: Who;
let manager: Who;
let spawner: Who;
let viewer: Who;
let outsider: Who;
let operationId = "";
let archivedId = "";

const setRole = (who: Who, role: UserRole) =>
  office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, who.id)).run();
/** The person's GitHub account has the permission on the room's repo that gives `access`. */
const grant = (operation: string, who: Who, access: OperationAccess) =>
  seedRoomMember(office.db, who.id, operation, access);
const list = (who?: Who) => office.request("/api/users", { cookie: who?.cookie });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-people-"));
  const remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello");
  office = startOffice();
  operations = createOperations({
    db: office.db,
    logger: createLogger({ level: "silent" }),
    config: { projectsDir: join(root, "projects"), githubRemoteBase: remoteBase },
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
  });
  mountOperationRoutes(office.server.router, { auth: office.auth, operations: operations.service });
  owner = await office.signUp("Olga");
  admin = await office.signUp("Ada");
  manager = await office.signUp("Mia");
  spawner = await office.signUp("Sam");
  viewer = await office.signUp("Vic");
  outsider = await office.signUp("Oz");
  setRole(admin, "admin");
  setRole(viewer, "viewer");

  const actor = { id: owner.id, role: "owner" as const };
  seedGitHubLink(office.db, owner.id);
  const create = (name: string) =>
    operations.service.create(
      actor,
      { name, tier: "small", repos: [{ repo: "octo/hello" }] },
      undefined,
      "admin",
    ).operation.operationId;
  operationId = create("Apollo");
  archivedId = create("Old");
  await operations.cloner.idle();
  grant(operationId, manager, "manage");
  grant(operationId, spawner, "spawn");
  // A viewer who administers the repo on GitHub is still capped at `view`.
  grant(operationId, viewer, "manage");
  grant(archivedId, outsider, "manage");
  // A `manage` member row on the live room, with no GitHub access to its repo: grants nothing.
  office.db
    .insert(operationMembers)
    .values({ operationId, userId: outsider.id, access: "manage" })
    .run();
  operations.service.archive(actor, archivedId);
});

afterAll(async () => {
  await operations.cloner.idle();
  await office.stop();
  await rm(root, { recursive: true, force: true });
});

describe("GET /api/users", () => {
  test("anonymous callers get 401", async () => {
    expect((await list()).status).toBe(401);
  });

  test("a viewer gets 403, even as an admin of the repo on GitHub", async () => {
    const res = await list(viewer);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "operation_manage_required" });
  });

  test("a member without manage gets 403", async () => {
    expect((await list(spawner)).status).toBe(403);
  });

  test("manage on an archived operation does not count, nor does a member row without GitHub access", async () => {
    expect((await list(outsider)).status).toBe(403);
    const room = await office.request(`/api/operations/${operationId}`, {
      cookie: outsider.cookie,
    });
    expect(room.status).toBe(404);
  });

  test("an operation manager gets everyone by name and role, with no emails", async () => {
    const res = await list(manager);
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const who of [owner, admin, manager, spawner, viewer, outsider]) {
      expect(text).not.toContain(who.email);
    }
    const body = JSON.parse(text) as OfficeUsersResponse;
    expect(body.users.map((u) => [u.displayName, u.role])).toEqual([
      ["Ada", "admin"],
      ["Mia", "member"],
      ["Olga", "owner"],
      ["Oz", "member"],
      ["Sam", "member"],
      ["Vic", "viewer"],
    ]);
    expect(body.users.every((u) => !("email" in u))).toBe(true);
  });

  test("owners and admins also see emails", async () => {
    for (const who of [owner, admin]) {
      const res = await list(who);
      expect(res.status).toBe(200);
      const body = (await res.json()) as OfficeUsersResponse;
      expect(body.users.find((u) => u.userId === spawner.id)?.email).toBe(spawner.email);
    }
  });

  test("an operation manager sets, changes and lifts a person's limit over the member routes", async () => {
    const path = `/api/operations/${operationId}/members/${outsider.id}`;
    const put = (access: OperationAccess) =>
      office.request(path, {
        method: "PUT",
        body: JSON.stringify({ access }),
        cookie: manager.cookie,
      });
    expect((await put("spawn")).status).toBe(204);
    expect((await put("view")).status).toBe(204);
    const members = (await (
      await office.request(`/api/operations/${operationId}/members`, { cookie: manager.cookie })
    ).json()) as { members: { userId: string; access: string }[] };
    expect(members.members.find((m) => m.userId === outsider.id)?.access).toBe("view");
    const del = await office.request(path, { method: "DELETE", cookie: manager.cookie });
    expect(del.status).toBe(204);
    // The spawn-only member cannot do any of it.
    const denied = await office.request(path, {
      method: "PUT",
      body: JSON.stringify({ access: "view" }),
      cookie: spawner.cookie,
    });
    expect(denied.status).toBe(403);
  });
});
