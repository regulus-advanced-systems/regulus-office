/** `GET /api/users` ACL over a real server: only floor managers list people; emails for admins only. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FloorAccess, OfficeUsersResponse, UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { floorMembers, userProfiles } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { createFloors, type Floors, mountFloorRoutes } from "./index.ts";
import { makeBareRepo } from "./test-helpers.ts";

type Who = { id: string; email: string; cookie: string };

let root: string;
let office: Office;
let floors: Floors;
let owner: Who;
let admin: Who;
let manager: Who;
let spawner: Who;
let viewer: Who;
let outsider: Who;
let floorId = "";
let archivedId = "";

const setRole = (who: Who, role: UserRole) =>
  office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, who.id)).run();
const grant = (floor: string, who: Who, access: FloorAccess) =>
  office.db.insert(floorMembers).values({ floorId: floor, userId: who.id, access }).run();
const list = (who?: Who) => office.request("/api/users", { cookie: who?.cookie });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-people-"));
  const remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello");
  office = startOffice();
  floors = createFloors({
    db: office.db,
    logger: createLogger({ level: "silent" }),
    config: { projectsDir: join(root, "projects"), githubRemoteBase: remoteBase },
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
  });
  mountFloorRoutes(office.server.router, { auth: office.auth, floors: floors.service });
  owner = await office.signUp("Olga");
  admin = await office.signUp("Ada");
  manager = await office.signUp("Mia");
  spawner = await office.signUp("Sam");
  viewer = await office.signUp("Vic");
  outsider = await office.signUp("Oz");
  setRole(admin, "admin");
  setRole(viewer, "viewer");

  const actor = { id: owner.id, role: "owner" as const };
  floorId = floors.service.create(actor, {
    name: "Apollo",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  }).floor.floorId;
  archivedId = floors.service.create(actor, {
    name: "Old",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  }).floor.floorId;
  await floors.cloner.idle();
  grant(floorId, manager, "manage");
  grant(floorId, spawner, "spawn");
  // A viewer's stored `manage` is capped at `view`, so it grants nothing here.
  grant(floorId, viewer, "manage");
  grant(archivedId, outsider, "manage");
  floors.service.archive(actor, archivedId);
});

afterAll(async () => {
  await floors.cloner.idle();
  await office.stop();
  await rm(root, { recursive: true, force: true });
});

describe("GET /api/users", () => {
  test("anonymous callers get 401", async () => {
    expect((await list()).status).toBe(401);
  });

  test("a viewer gets 403, even with a stored manage row", async () => {
    const res = await list(viewer);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "floor_manage_required" });
  });

  test("a member without manage gets 403", async () => {
    expect((await list(spawner)).status).toBe(403);
  });

  test("manage on an archived floor does not count", async () => {
    expect((await list(outsider)).status).toBe(403);
  });

  test("a floor manager gets everyone by name and role, with no emails", async () => {
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

  test("a floor manager grants, changes and revokes over the member routes", async () => {
    const path = `/api/floors/${floorId}/members/${outsider.id}`;
    const put = (access: FloorAccess) =>
      office.request(path, {
        method: "PUT",
        body: JSON.stringify({ access }),
        cookie: manager.cookie,
      });
    expect((await put("spawn")).status).toBe(204);
    expect((await put("view")).status).toBe(204);
    const members = (await (
      await office.request(`/api/floors/${floorId}/members`, { cookie: manager.cookie })
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
