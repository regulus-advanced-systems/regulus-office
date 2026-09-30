/**
 * Archive, restore, send-home and delete over HTTP (#150): owners and admins
 * only (a floor manager, a member and a viewer get 403), same-origin, and the
 * refused delete names the robots still on the floor.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FloorAccess, FloorInfo, UserRole } from "@regulus/protocol";
import { FloorHasRobotsResponse } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { agents, desks, floorMembers, userProfiles } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { createFloors, type Floors, mountFloorRoutes } from "./index.ts";
import { makeBareRepo } from "./test-helpers.ts";

type Who = { id: string; cookie: string };

let root: string;
let office: Office;
let floors: Floors;
let owner: Who;
let admin: Who;
let manager: Who;
let member: Who;
let viewer: Who;
let floor: FloorInfo;

const setRole = (who: Who, role: UserRole) =>
  office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, who.id)).run();
const grant = (who: Who, access: FloorAccess) =>
  office.db.insert(floorMembers).values({ floorId: floor.floorId, userId: who.id, access }).run();
const send = (method: string, path: string, who: Who, body: unknown = {}, origin?: string) =>
  office.request(path, {
    method,
    body: JSON.stringify(body),
    cookie: who.cookie,
    headers: origin ? { origin } : undefined,
  });
const path = (suffix = "") => `/api/floors/${floor.floorId}${suffix}`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rg150-routes-"));
  const remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello");
  office = startOffice();
  floors = createFloors({
    db: office.db,
    logger: createLogger({ level: "silent" }),
    config: {
      projectsDir: join(root, "projects"),
      worktreesDir: join(root, "worktrees"),
      githubRemoteBase: remoteBase,
    },
    keyring: undefined,
  });
  mountFloorRoutes(office.server.router, {
    auth: office.auth,
    floors: floors.service,
    lifecycle: floors.lifecycle,
  });
  owner = await office.signUp("Olga");
  admin = await office.signUp("Ada");
  manager = await office.signUp("Mia");
  member = await office.signUp("Sam");
  viewer = await office.signUp("Vic");
  setRole(admin, "admin");
  setRole(viewer, "viewer");
  const created = floors.service.create(
    { id: owner.id, role: "owner" },
    { name: "Apollo", tier: "small", repos: [{ repo: "octo/hello" }] },
  );
  await created.cloned;
  floor = created.floor;
  grant(manager, "manage");
  grant(member, "spawn");
  grant(viewer, "view");
});

afterAll(async () => {
  await floors.cloner.idle();
  await office.stop();
  await rm(root, { recursive: true, force: true });
});

describe("floor lifecycle routes", () => {
  test("a floor manager, a member and a viewer get 403 for every lifecycle call", async () => {
    for (const who of [manager, member, viewer]) {
      const calls = [
        await office.request("/api/floors/archived", { cookie: who.cookie }),
        await send("POST", path("/archive"), who),
        await send("POST", path("/restore"), who),
        await send("POST", path("/send-home"), who),
        await send("DELETE", path(), who, { confirmName: "Apollo" }),
      ];
      expect(calls.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    }
    expect((await office.request("/api/floors/archived")).status).toBe(401);
  });

  test("cross-origin writes are refused", async () => {
    const evil = "https://evil.example";
    expect((await send("POST", path("/archive"), owner, {}, evil)).status).toBe(403);
    expect((await send("DELETE", path(), owner, { confirmName: "Apollo" }, evil)).status).toBe(403);
  });

  test("archive, list archived, restore", async () => {
    expect((await send("POST", path("/archive"), admin)).status).toBe(204);
    const archived = await office.request("/api/floors/archived", { cookie: owner.cookie });
    const body = (await archived.json()) as { floors: FloorInfo[] };
    expect(body.floors.map((f) => [f.name, f.archivedAt !== null])).toEqual([["Apollo", true]]);
    const restored = await send("POST", path("/restore"), owner);
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as FloorInfo).archivedAt).toBeNull();
    expect((await send("POST", path("/restore"), owner)).status).toBe(409);
  });

  test("delete is refused with the robots on the floor, then works once they went home", async () => {
    const repoId = floor.repos[0]?.repoId ?? "";
    const desk = office.db.select().from(desks).where(eq(desks.floorId, floor.floorId)).get();
    const agentId = randomUUID();
    office.db
      .insert(agents)
      .values({
        id: agentId,
        floorId: floor.floorId,
        repoId,
        deskSeatId: desk?.seatId ?? "",
        ownerUserId: member.id,
        provider: "claude-code",
        model: "opus",
        profileId: "login:claude-code",
        status: "idle",
        workdir: "/nowhere",
        taskTitle: "Tidy up",
      })
      .run();
    office.db
      .update(desks)
      .set({ agentId })
      .where(eq(desks.id, desk?.id ?? ""))
      .run();

    const refused = await send("DELETE", path(), owner, { confirmName: "Apollo" });
    expect(refused.status).toBe(409);
    const parsed = FloorHasRobotsResponse.parse(await refused.json());
    expect(parsed.robots.map((r) => [r.agentId, r.ownerName, r.running])).toEqual([
      [agentId, "Sam", true],
    ]);

    floors.lifecycle.robots = {
      sendHome: async (_actor, id) => {
        office.db.update(desks).set({ agentId: null }).where(eq(desks.agentId, id)).run();
        office.db.update(agents).set({ status: "exited" }).where(eq(agents.id, id)).run();
      },
    };
    const home = await send("POST", path("/send-home"), admin);
    expect(await home.json()).toEqual({ sentHome: 1, failed: [] });

    expect((await send("DELETE", path(), owner, { confirmName: "Hermes" })).status).toBe(400);
    expect((await send("DELETE", path(), owner, { confirmName: "Apollo" })).status).toBe(204);
    expect(await stat(join(root, "projects", "apollo")).catch(() => null)).toBeNull();
    expect((await office.request(path(), { cookie: owner.cookie })).status).toBe(404);
    expect((await send("DELETE", path(), owner, { confirmName: "Apollo" })).status).toBe(404);
  });
});
