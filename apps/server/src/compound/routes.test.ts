/**
 * Compound REST (#181): owners and admins place, move and remove rooms (a
 * operation manager, a member and a viewer get 403; anonymous 401; cross-origin
 * 403), of repos their own GitHub account can see (#270: 404 otherwise, and the
 * layout is per viewer), every change is audited, invalid placements and moves
 * with running henchmen are refused, and removal is the operation delete.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompoundLayoutResponse,
  type CompoundRoomInfo,
  type OperationAccess,
  type OperationInfo,
  PlacementCheckResponse,
  PlacementRefusedResponse,
  PlaceRoomResponse,
  RoomHasRunningHenchmenResponse,
  type RoomPlacement,
  type UserRole,
} from "@regulus/protocol";
import { layoutProblems } from "@regulus/room-layout";
import { and, eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { agents, auditLog, desks, userProfiles } from "../db/schema/index.ts";
import {
  seedGitHubLink,
  seedRepoPermission,
  seedRoomMember,
} from "../github/access/test-snapshot.ts";
import { createLogger } from "../logging.ts";
import { createOperations, mountOperationRoutes, type Operations } from "../operations/index.ts";
import { makeBareRepo } from "../operations/test-helpers.ts";
import { mountCompoundRoutes } from "./routes.ts";
import { CompoundService } from "./service.ts";
import { liveRooms, readSpec } from "./store.ts";

type Who = { id: string; cookie: string };

let root: string;
let office: Office;
let operations: Operations;
let compound: CompoundService;
let owner: Who;
let admin: Who;
/** An office admin with a linked GitHub account that sees none of the repos. */
let blindAdmin: Who;
let manager: Who;
let member: Who;
let viewer: Who;
let apollo: OperationInfo;
const published: number[] = [];

const setRole = (who: Who, role: UserRole) =>
  office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, who.id)).run();
/** The person's GitHub account has the permission on the room's repo that gives `access`. */
const grant = (who: Who, operationId: string, access: OperationAccess) =>
  seedRoomMember(office.db, who.id, operationId, access);
const send = (method: string, path: string, who: Who | null, body: unknown = {}, origin?: string) =>
  office.request(path, {
    method,
    body: JSON.stringify(body),
    cookie: who?.cookie,
    headers: origin ? { origin } : undefined,
  });

const spot = (gridX: number, gridY: number, extra: Partial<RoomPlacement> = {}): RoomPlacement => ({
  gridX,
  gridY,
  width: 8,
  depth: 8,
  doorSide: "south",
  ...extra,
});

const layout = async (who: Who) =>
  CompoundLayoutResponse.parse(
    await (await office.request("/api/compound", { cookie: who.cookie })).json(),
  );
const roomOf = async (operationId: string): Promise<CompoundRoomInfo | undefined> =>
  (await layout(owner)).rooms.find((r) => r.operationId === operationId);
const audits = (action: string, targetId: string) =>
  office.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)))
    .all();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rg181-routes-"));
  const remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello");
  office = startOffice();
  const logger = createLogger({ level: "silent" });
  compound = new CompoundService({
    db: office.db,
    logger,
    config: { buildMs: 60_000, sizeTiles: 64 },
    publish: (s) => published.push(s.state.version),
  });
  compound.boot();
  operations = createOperations({
    db: office.db,
    logger,
    config: {
      projectsDir: join(root, "projects"),
      worktreesDir: join(root, "worktrees"),
      githubRemoteBase: remoteBase,
    },
    keyring: undefined,
    placer: compound,
    onChange: (operationId) => compound.operationChanged(operationId),
    // GitHub's answers (#270): the owner and the admin administer every repo; the
    // refresh after a new room brings the other one's snapshot up to date.
    newRoomAccess: {
      permissionOf: async (userId) =>
        userId === owner.id || userId === admin.id ? "admin" : "none",
      roomCreated: (repoId) => {
        for (const who of [owner, admin]) seedRepoPermission(office.db, who.id, repoId, "admin");
      },
    },
  });
  mountOperationRoutes(office.server.router, {
    auth: office.auth,
    operations: operations.service,
    lifecycle: operations.lifecycle,
  });
  mountCompoundRoutes(office.server.router, {
    auth: office.auth,
    compound,
    operations: operations.service,
    lifecycle: operations.lifecycle,
  });
  owner = await office.signUp("Olga");
  admin = await office.signUp("Ada");
  manager = await office.signUp("Mia");
  member = await office.signUp("Sam");
  viewer = await office.signUp("Vic");
  blindAdmin = await office.signUp("Bea");
  setRole(admin, "admin");
  setRole(blindAdmin, "admin");
  setRole(viewer, "viewer");
  for (const who of [owner, admin, blindAdmin]) seedGitHubLink(office.db, who.id);
  const created = await operations.service.createChecked(
    { id: owner.id, role: "owner" },
    { name: "Apollo", tier: "small", repos: [{ repo: "octo/hello" }] },
  );
  await created.cloned;
  apollo = created.operation;
  grant(manager, apollo.operationId, "manage");
  grant(member, apollo.operationId, "spawn");
  grant(viewer, apollo.operationId, "view");
});

afterAll(async () => {
  compound.close();
  await operations.cloner.idle();
  await office.stop();
  await rm(root, { recursive: true, force: true });
});

describe("compound routes", () => {
  test("anyone signed in reads the layout; the old create API auto-places the room", async () => {
    expect((await office.request("/api/compound")).status).toBe(401);
    const seen = await layout(viewer);
    expect(seen.compound.width).toBe(64);
    expect(seen.compound.specialRooms.map((s) => s.kind)).toEqual([
      "lobby",
      "conference",
      "break_room",
    ]);
    const room = seen.rooms.find((r) => r.operationId === apollo.operationId);
    expect(room).toMatchObject({ name: "Apollo", doorSide: "south", buildState: "building" });
    expect(room?.buildEndsAt).toBeGreaterThan(Date.now());
    expect(audits("compound.room_place", apollo.operationId)).toHaveLength(1);
  });

  test("an operation manager, a member and a viewer get 403 on every write", async () => {
    const path = `/api/compound/rooms/${apollo.operationId}`;
    for (const who of [manager, member, viewer]) {
      const calls = [
        await send("POST", "/api/compound/check", who, { placement: spot(4, 4) }),
        await send("POST", "/api/compound/rooms", who, {
          name: "Nope",
          repos: [{ repo: "octo/hello" }],
          placement: spot(4, 4),
        }),
        await send("PATCH", path, who, { placement: spot(4, 4) }),
        await send("DELETE", path, who, { confirmName: "Apollo" }),
      ];
      expect(calls.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    }
    expect((await send("PATCH", path, null, { placement: spot(4, 4) })).status).toBe(401);
    const evil = "https://evil.example";
    expect((await send("PATCH", path, owner, { placement: spot(4, 4) }, evil)).status).toBe(403);
    expect((await send("DELETE", path, owner, { confirmName: "Apollo" }, evil)).status).toBe(403);
    expect((await roomOf(apollo.operationId))?.gridX).not.toBe(4);
  });

  test("check reports why a ghost is red", async () => {
    const ok = PlacementCheckResponse.parse(
      await (await send("POST", "/api/compound/check", admin, { placement: spot(4, 4) })).json(),
    );
    expect(ok).toEqual({ ok: true, conflicts: [] });
    const lobby = await send("POST", "/api/compound/check", admin, { placement: spot(28, 56) });
    expect(PlacementCheckResponse.parse(await lobby.json())).toEqual({
      ok: false,
      reason: "overlap",
      conflicts: ["lobby"],
    });
    const bad = await send("POST", "/api/compound/check", admin, {
      placement: spot(4, 4, { width: 3 }),
    });
    expect(bad.status).toBe(400);
  });

  test("an owner places a room where they choose; an invalid spot is refused", async () => {
    const refused = await send("POST", "/api/compound/rooms", owner, {
      name: "Clash",
      repos: [{ repo: "octo/hello" }],
      placement: spot(60, 4),
    });
    expect(refused.status).toBe(409);
    expect(PlacementRefusedResponse.parse(await refused.json()).reason).toBe("out_of_bounds");
    expect(operations.service.list({ id: owner.id, role: "owner" }).map((f) => f.name)).toEqual([
      "Apollo",
    ]);

    const res = await send("POST", "/api/compound/rooms", admin, {
      name: "Hermes",
      repos: [{ repo: "octo/hello" }],
      placement: spot(4, 4, { doorSide: "east", width: 6 }),
    });
    expect(res.status).toBe(201);
    const { operation, room } = PlaceRoomResponse.parse(await res.json());
    expect(room).toMatchObject({ gridX: 4, gridY: 4, width: 6, doorSide: "east" });
    expect(room.buildState).toBe("building");
    expect(audits("compound.room_place", operation.operationId)[0]?.userId).toBe(admin.id);
    expect(audits("operation.create", operation.operationId)).toHaveLength(1);
    // Build mode (#187): a placed room starts vanilla, one desk of four seats (D8).
    const seats = office.db
      .select()
      .from(desks)
      .where(eq(desks.operationId, operation.operationId))
      .all();
    expect(seats.map((d) => d.seatId).sort()).toEqual(["d1s1", "d1s2", "d1s3", "d1s4"]);
    const spec = readSpec(office.db);
    const placed = liveRooms(office.db).map((r) => ({
      id: r.id,
      placement: r.placement as RoomPlacement,
    }));
    if (spec) expect(layoutProblems(spec, placed)).toEqual([]);
    await operations.cloner.idle();

    // The layout is per viewer: Sam works in Apollo only, so Hermes (same level) is a closed door.
    const seen = (await layout(member)).rooms.map((r) => [r.name, r.closed, r.buildState]);
    expect(seen.sort()).toEqual([
      ["", true, "ready"],
      ["Apollo", undefined, "building"],
    ]);
    const closed = (await layout(member)).rooms.find((r) => r.closed);
    expect(closed).toMatchObject({ operationId: operation.operationId, gridX: 4, buildEndsAt: 0 });
  });

  test("an office admin whose GitHub account sees no repo gets the lobby and 404s", async () => {
    const seen = await layout(blindAdmin);
    expect(seen.levels.map((l) => l.kind)).toEqual(["lobby"]);
    expect(seen.rooms).toEqual([]);
    const refused = await send("POST", "/api/compound/rooms", blindAdmin, {
      name: "Blind",
      repos: [{ repo: "octo/hello" }],
      placement: spot(30, 30),
    });
    expect([refused.status, await refused.json()]).toMatchObject([
      403,
      { error: "repo_not_visible" },
    ]);
    const path = `/api/compound/rooms/${apollo.operationId}`;
    const before = await roomOf(apollo.operationId);
    const moved = await send("PATCH", path, blindAdmin, { placement: spot(40, 30) });
    expect([moved.status, await moved.json()]).toEqual([404, { error: "operation_not_found" }]);
    const removed = await send("DELETE", path, blindAdmin, { confirmName: "Apollo" });
    expect(removed.status).toBe(404);
    expect(await roomOf(apollo.operationId)).toEqual(before);
    // The ghost check tells them nothing about a level they cannot reach: an empty grid.
    const taken = { placement: before, levelId: apollo.levelId };
    const check = async (who: Who) =>
      PlacementCheckResponse.parse(
        await (await send("POST", "/api/compound/check", who, taken)).json(),
      ).ok;
    expect([await check(owner), await check(blindAdmin)]).toEqual([false, true]);
  });

  test("moving: refused while a henchman runs in the room, refused onto another room, audited", async () => {
    const path = `/api/compound/rooms/${apollo.operationId}`;
    const desk = office.db
      .select()
      .from(desks)
      .where(eq(desks.operationId, apollo.operationId))
      .get();
    const agentId = randomUUID();
    office.db
      .insert(agents)
      .values({
        id: agentId,
        operationId: apollo.operationId,
        repoId: apollo.repos[0]?.repoId ?? "",
        deskSeatId: desk?.seatId ?? "",
        ownerUserId: member.id,
        provider: "claude-code",
        model: "opus",
        profileId: "login:claude-code",
        status: "working",
        workdir: "/nowhere",
        taskTitle: "Busy",
      })
      .run();
    office.db
      .update(desks)
      .set({ agentId })
      .where(eq(desks.id, desk?.id ?? ""))
      .run();

    const busy = await send("PATCH", path, owner, { placement: spot(40, 10) });
    expect(busy.status).toBe(409);
    expect(
      RoomHasRunningHenchmenResponse.parse(await busy.json()).henchmen.map((r) => r.agentId),
    ).toEqual([agentId]);

    // An exited henchman still holding its seat moves with the room.
    office.db.update(agents).set({ status: "exited" }).where(eq(agents.id, agentId)).run();
    const onHermes = await send("PATCH", path, owner, { placement: spot(5, 5) });
    expect(onHermes.status).toBe(409);
    expect(PlacementRefusedResponse.parse(await onHermes.json()).reason).toBe("overlap");

    const before = published.length;
    const moved = await send("PATCH", path, admin, { placement: spot(40, 10, { width: 10 }) });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ gridX: 40, gridY: 10, width: 10 });
    expect(published.length).toBeGreaterThan(before);
    const audit = audits("compound.room_move", apollo.operationId);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.metaJson ?? "{}").to).toMatchObject({ gridX: 40, gridY: 10 });
    expect(office.db.select().from(desks).where(eq(desks.agentId, agentId)).get()).toBeDefined();
  });

  test("removing is the operation delete: typed name, henchmen first, then gone from the layout", async () => {
    const path = `/api/compound/rooms/${apollo.operationId}`;
    const held = await send("DELETE", path, owner, { confirmName: "Apollo" });
    expect(held.status).toBe(409);
    office.db
      .update(desks)
      .set({ agentId: null })
      .where(eq(desks.operationId, apollo.operationId))
      .run();
    expect((await send("DELETE", path, owner, { confirmName: "Nope" })).status).toBe(400);
    expect((await send("DELETE", path, owner, { confirmName: "Apollo" })).status).toBe(204);
    expect(await roomOf(apollo.operationId)).toBeUndefined();
    expect(audits("operation.delete", apollo.operationId).length).toBeGreaterThan(0);
  });
});
