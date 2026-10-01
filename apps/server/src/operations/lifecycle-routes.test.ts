/**
 * Archive, restore, send-home and delete over HTTP (#150): owners and admins
 * only (an operation manager, a member and a viewer get 403), same-origin, and the
 * refused delete names the henchmen still on the operation.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperationAccess, OperationInfo, UserRole } from "@regulus/protocol";
import { OperationHasHenchmenResponse } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { agents, desks, operationMembers, userProfiles } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { createOperations, mountOperationRoutes, type Operations } from "./index.ts";
import { makeBareRepo } from "./test-helpers.ts";

type Who = { id: string; cookie: string };

let root: string;
let office: Office;
let operations: Operations;
let owner: Who;
let admin: Who;
let manager: Who;
let member: Who;
let viewer: Who;
let operation: OperationInfo;

const setRole = (who: Who, role: UserRole) =>
  office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, who.id)).run();
const grant = (who: Who, access: OperationAccess) =>
  office.db
    .insert(operationMembers)
    .values({ operationId: operation.operationId, userId: who.id, access })
    .run();
const send = (method: string, path: string, who: Who, body: unknown = {}, origin?: string) =>
  office.request(path, {
    method,
    body: JSON.stringify(body),
    cookie: who.cookie,
    headers: origin ? { origin } : undefined,
  });
const path = (suffix = "") => `/api/operations/${operation.operationId}${suffix}`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rg150-routes-"));
  const remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello");
  office = startOffice();
  operations = createOperations({
    db: office.db,
    logger: createLogger({ level: "silent" }),
    config: {
      projectsDir: join(root, "projects"),
      worktreesDir: join(root, "worktrees"),
      githubRemoteBase: remoteBase,
    },
    keyring: undefined,
  });
  mountOperationRoutes(office.server.router, {
    auth: office.auth,
    operations: operations.service,
    lifecycle: operations.lifecycle,
  });
  owner = await office.signUp("Olga");
  admin = await office.signUp("Ada");
  manager = await office.signUp("Mia");
  member = await office.signUp("Sam");
  viewer = await office.signUp("Vic");
  setRole(admin, "admin");
  setRole(viewer, "viewer");
  const created = operations.service.create(
    { id: owner.id, role: "owner" },
    { name: "Apollo", tier: "small", repos: [{ repo: "octo/hello" }] },
  );
  await created.cloned;
  operation = created.operation;
  grant(manager, "manage");
  grant(member, "spawn");
  grant(viewer, "view");
});

afterAll(async () => {
  await operations.cloner.idle();
  await office.stop();
  await rm(root, { recursive: true, force: true });
});

describe("operation lifecycle routes", () => {
  test("an operation manager, a member and a viewer get 403 for every lifecycle call", async () => {
    for (const who of [manager, member, viewer]) {
      const calls = [
        await office.request("/api/operations/archived", { cookie: who.cookie }),
        await send("POST", path("/archive"), who),
        await send("POST", path("/restore"), who),
        await send("POST", path("/send-home"), who),
        await send("DELETE", path(), who, { confirmName: "Apollo" }),
      ];
      expect(calls.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    }
    expect((await office.request("/api/operations/archived")).status).toBe(401);
  });

  test("cross-origin writes are refused", async () => {
    const evil = "https://evil.example";
    expect((await send("POST", path("/archive"), owner, {}, evil)).status).toBe(403);
    expect((await send("DELETE", path(), owner, { confirmName: "Apollo" }, evil)).status).toBe(403);
  });

  test("archive, list archived, restore", async () => {
    expect((await send("POST", path("/archive"), admin)).status).toBe(204);
    const archived = await office.request("/api/operations/archived", { cookie: owner.cookie });
    const body = (await archived.json()) as { operations: OperationInfo[] };
    expect(body.operations.map((f) => [f.name, f.archivedAt !== null])).toEqual([["Apollo", true]]);
    const restored = await send("POST", path("/restore"), owner);
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as OperationInfo).archivedAt).toBeNull();
    expect((await send("POST", path("/restore"), owner)).status).toBe(409);
  });

  test("delete is refused with the henchmen on the operation, then works once they went home", async () => {
    const repoId = operation.repos[0]?.repoId ?? "";
    const desk = office.db
      .select()
      .from(desks)
      .where(eq(desks.operationId, operation.operationId))
      .get();
    const agentId = randomUUID();
    office.db
      .insert(agents)
      .values({
        id: agentId,
        operationId: operation.operationId,
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
    const parsed = OperationHasHenchmenResponse.parse(await refused.json());
    expect(parsed.henchmen.map((r) => [r.agentId, r.ownerName, r.running])).toEqual([
      [agentId, "Sam", true],
    ]);

    operations.lifecycle.henchmen = {
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
