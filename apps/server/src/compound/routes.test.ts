/**
 * Compound REST (#181): owners and admins place, move and remove rooms (a
 * floor manager, a member and a viewer get 403; anonymous 401; cross-origin
 * 403), every change is audited, invalid placements and moves with running
 * robots are refused, and removal is the floor delete.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutProblems } from "@regulus/floor-layout";
import {
  CompoundLayoutResponse,
  type CompoundRoomInfo,
  type FloorAccess,
  type FloorInfo,
  PlacementCheckResponse,
  PlacementRefusedResponse,
  PlaceRoomResponse,
  RoomHasRunningRobotsResponse,
  type RoomPlacement,
  type UserRole,
} from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { agents, auditLog, desks, floorMembers, userProfiles } from "../db/schema/index.ts";
import { createFloors, type Floors, mountFloorRoutes } from "../floors/index.ts";
import { makeBareRepo } from "../floors/test-helpers.ts";
import { createLogger } from "../logging.ts";
import { mountCompoundRoutes } from "./routes.ts";
import { CompoundService } from "./service.ts";
import { liveRooms, readSpec } from "./store.ts";

type Who = { id: string; cookie: string };

let root: string;
let office: Office;
let floors: Floors;
let compound: CompoundService;
let owner: Who;
let admin: Who;
let manager: Who;
let member: Who;
let viewer: Who;
let apollo: FloorInfo;
const published: number[] = [];

const setRole = (who: Who, role: UserRole) =>
  office.db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, who.id)).run();
const grant = (who: Who, floorId: string, access: FloorAccess) =>
  office.db.insert(floorMembers).values({ floorId, userId: who.id, access }).run();
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
const roomOf = async (floorId: string): Promise<CompoundRoomInfo | undefined> =>
  (await layout(owner)).rooms.find((r) => r.floorId === floorId);
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
  floors = createFloors({
    db: office.db,
    logger,
    config: {
      projectsDir: join(root, "projects"),
      worktreesDir: join(root, "worktrees"),
      githubRemoteBase: remoteBase,
    },
    keyring: undefined,
    placer: compound,
    onChange: (floorId) => compound.floorChanged(floorId),
  });
  mountFloorRoutes(office.server.router, {
    auth: office.auth,
    floors: floors.service,
    lifecycle: floors.lifecycle,
  });
  mountCompoundRoutes(office.server.router, {
    auth: office.auth,
    compound,
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
  apollo = created.floor;
  grant(manager, apollo.floorId, "manage");
  grant(member, apollo.floorId, "spawn");
  grant(viewer, apollo.floorId, "view");
});

afterAll(async () => {
  compound.close();
  await floors.cloner.idle();
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
    const room = seen.rooms.find((r) => r.floorId === apollo.floorId);
    expect(room).toMatchObject({ name: "Apollo", doorSide: "south", buildState: "building" });
    expect(room?.buildEndsAt).toBeGreaterThan(Date.now());
    expect(audits("compound.room_place", apollo.floorId)).toHaveLength(1);
  });

  test("a floor manager, a member and a viewer get 403 on every write", async () => {
    const path = `/api/compound/rooms/${apollo.floorId}`;
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
    expect((await roomOf(apollo.floorId))?.gridX).not.toBe(4);
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
    expect(floors.service.list({ id: owner.id, role: "owner" }).map((f) => f.name)).toEqual([
      "Apollo",
    ]);

    const res = await send("POST", "/api/compound/rooms", admin, {
      name: "Hermes",
      repos: [{ repo: "octo/hello" }],
      placement: spot(4, 4, { doorSide: "east", width: 6 }),
    });
    expect(res.status).toBe(201);
    const { floor, room } = PlaceRoomResponse.parse(await res.json());
    expect(room).toMatchObject({ gridX: 4, gridY: 4, width: 6, doorSide: "east" });
    expect(room.buildState).toBe("building");
    expect(audits("compound.room_place", floor.floorId)[0]?.userId).toBe(admin.id);
    expect(audits("floor.create", floor.floorId)).toHaveLength(1);
    const spec = readSpec(office.db);
    const placed = liveRooms(office.db).map((r) => ({
      id: r.id,
      placement: r.placement as RoomPlacement,
    }));
    if (spec) expect(layoutProblems(spec, placed)).toEqual([]);
    await floors.cloner.idle();
  });

  test("moving: refused while a robot runs in the room, refused onto another room, audited", async () => {
    const path = `/api/compound/rooms/${apollo.floorId}`;
    const desk = office.db.select().from(desks).where(eq(desks.floorId, apollo.floorId)).get();
    const agentId = randomUUID();
    office.db
      .insert(agents)
      .values({
        id: agentId,
        floorId: apollo.floorId,
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
      RoomHasRunningRobotsResponse.parse(await busy.json()).robots.map((r) => r.agentId),
    ).toEqual([agentId]);

    // An exited robot still holding its seat moves with the room.
    office.db.update(agents).set({ status: "exited" }).where(eq(agents.id, agentId)).run();
    const onHermes = await send("PATCH", path, owner, { placement: spot(5, 5) });
    expect(onHermes.status).toBe(409);
    expect(PlacementRefusedResponse.parse(await onHermes.json()).reason).toBe("overlap");

    const before = published.length;
    const moved = await send("PATCH", path, admin, { placement: spot(40, 10, { width: 10 }) });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ gridX: 40, gridY: 10, width: 10 });
    expect(published.length).toBeGreaterThan(before);
    const audit = audits("compound.room_move", apollo.floorId);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.metaJson ?? "{}").to).toMatchObject({ gridX: 40, gridY: 10 });
    expect(office.db.select().from(desks).where(eq(desks.agentId, agentId)).get()).toBeDefined();
  });

  test("removing is the floor delete: typed name, robots first, then gone from the layout", async () => {
    const path = `/api/compound/rooms/${apollo.floorId}`;
    const held = await send("DELETE", path, owner, { confirmName: "Apollo" });
    expect(held.status).toBe(409);
    office.db.update(desks).set({ agentId: null }).where(eq(desks.floorId, apollo.floorId)).run();
    expect((await send("DELETE", path, owner, { confirmName: "Nope" })).status).toBe(400);
    expect((await send("DELETE", path, owner, { confirmName: "Apollo" })).status).toBe(204);
    expect(await roomOf(apollo.floorId)).toBeUndefined();
    expect(audits("floor.delete", apollo.floorId).length).toBeGreaterThan(0);
  });
});
