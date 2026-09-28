/**
 * FloorRoom over the wire: one instance per floor, joins need view access,
 * desks come from the template, robots from the registry, archive closes the
 * room; BuildingRoom `floor.go` honours the same access rule.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import { smallTemplate } from "@regulus/floor-layout";
import {
  BuildingStateSchema,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  FloorStateSchema,
  ROOM_NAMES,
} from "@regulus/protocol";
import { robotFixture } from "@regulus/protocol/src/fixtures.ts";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { createFloors, type Floors } from "../../floors/index.ts";
import { makeBareRepo } from "../../floors/test-helpers.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { createRooms, type Rooms } from "../index.ts";

type FloorState = InstanceType<typeof FloorStateSchema>;
type BuildingState = InstanceType<typeof BuildingStateSchema>;

const logger = createLogger({ level: "silent" });
let dir: string;
let db: Db;
let rooms: Rooms;
let floors: Floors;
let server: OfficeServer;
let floorId: string;
let otherFloorId: string;
const opened: Room[] = [];

const users = {
  owner: { userId: "u-owner", displayName: "Olga", role: "owner" },
  member: { userId: "u-member", displayName: "Mia", role: "member" },
  stranger: { userId: "u-stranger", displayName: "Sam", role: "member" },
};

function client(user: (typeof users)[keyof typeof users]): Client {
  return new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: JSON.stringify(user) },
  });
}

async function joinFloor(user: (typeof users)[keyof typeof users], id: string) {
  const room = await client(user).joinOrCreate<FloorState>(
    ROOM_NAMES.floor,
    { floorId: id },
    FloorStateSchema,
  );
  opened.push(room);
  return room;
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "office-floor-room-"));
  const remoteBase = await makeBareRepo(join(dir, "remotes"), "octo", "hello");
  db = openDatabase({ path: join(dir, "office.db") });
  runMigrations(db);
  for (const u of Object.values(users)) {
    db.insert(schema.users)
      .values({ id: u.userId, name: u.displayName, email: `${u.userId}@x.test` })
      .run();
    db.insert(schema.userProfiles)
      .values({ userId: u.userId, displayName: u.displayName, role: u.role as "owner" | "member" })
      .run();
  }
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
  });
  floors = createFloors({
    db,
    logger,
    config: { projectsDir: join(dir, "projects"), githubRemoteBase: remoteBase },
    keyring: undefined,
    onChange: (id) => void rooms.floorChanged(id),
  });
  const owner = { id: users.owner.userId, role: "owner" as const };
  const a = floors.service.create(owner, {
    name: "Apollo",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  const b = floors.service.create(owner, {
    name: "Borealis",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  floorId = a.floor.floorId;
  otherFloorId = b.floor.floorId;
  floors.service.setMember(owner, floorId, users.member.userId, "view");
  await Promise.all([a.cloned, b.cloned]);
  server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: join(dir, "no-dist") },
    logger,
    version: "test",
    attach: rooms.transport.attachment,
  });
  await rooms.transport.listen();
});

afterAll(async () => {
  await Promise.all(opened.splice(0).map((r) => Promise.race([r.leave(), Bun.sleep(200)])));
  await rooms.transport.shutdown();
  await server.stop(true);
  closeDatabase(db);
  await rm(dir, { recursive: true, force: true });
});

describe("FloorRoom over the wire", () => {
  test("a member with view access joins and sees the floor, repos and template desks", async () => {
    const room = await joinFloor(users.member, floorId);
    await waitFor(() => room.state.floorId === floorId, "state");
    expect(room.state.name).toBe("Apollo");
    expect(room.state.layoutTemplateId).toBe(smallTemplate.id);
    expect(room.state.repos.map((r) => `${r.owner}/${r.name}@${r.defaultBranch}`)).toEqual([
      "octo/hello@trunk",
    ]);
    const seats = smallTemplate.seats.filter((s) => s.kind === "desk").map((s) => s.id);
    expect([...room.state.desks.keys()].sort()).toEqual([...seats].sort());
    expect(room.state.robots.size).toBe(0);
    expect(room.state.decor.size).toBe(0);
  });

  test("the same floor shares one instance; another floor gets its own", async () => {
    const a1 = await joinFloor(users.owner, floorId);
    const a2 = await joinFloor(users.member, floorId);
    const b = await joinFloor(users.owner, otherFloorId);
    expect(a1.roomId).toBe(a2.roomId);
    expect(b.roomId).not.toBe(a1.roomId);
    await waitFor(() => b.state.name === "Borealis", "other floor state");
  });

  test("no access, unknown floors and missing options are rejected", async () => {
    await expect(joinFloor(users.stranger, floorId)).rejects.toThrow(/access denied/);
    await expect(joinFloor(users.owner, "no-such-floor")).rejects.toThrow(/access denied/);
    await expect(
      client(users.owner).joinOrCreate(ROOM_NAMES.floor, {}, FloorStateSchema),
    ).rejects.toThrow(/invalid join options/);
  });

  test("published robots appear (and occupy their desk) until removed", async () => {
    const room = await joinFloor(users.member, floorId);
    const seatId = smallTemplate.seats.find((s) => s.kind === "desk")?.id ?? "";
    rooms.floors.publishRobot(floorId, { ...robotFixture, agentId: "agent-1", seatId });
    await waitFor(() => room.state.robots.has("agent-1"), "robot published");
    expect(room.state.robots.get("agent-1")?.status).toBe(robotFixture.status);
    expect(room.state.desks.get(seatId)?.agentId).toBe("agent-1");
    rooms.floors.publishRobot(floorId, {
      ...robotFixture,
      agentId: "agent-1",
      seatId,
      status: "working",
    });
    await waitFor(() => room.state.robots.get("agent-1")?.status === "working", "robot updated");
    rooms.floors.removeRobot(floorId, "agent-1");
    await waitFor(() => !room.state.robots.has("agent-1"), "robot removed");
    expect(room.state.desks.get(seatId)?.agentId).toBe("");
    expect(() =>
      rooms.floors.publishRobot(floorId, { ...robotFixture, status: "bogus" as never }),
    ).toThrow();
  });

  test("floor commands are rejected until their issues land", async () => {
    const room = await joinFloor(users.member, floorId);
    const rejected = new Promise<CommandRejected>((resolve) =>
      room.onMessage(COMMAND_REJECTED_MESSAGE, (m: CommandRejected) => resolve(m)),
    );
    room.send("decor.remove", { decorId: "d1" });
    expect((await rejected).type).toBe("decor.remove");
  });

  test("agent.spawn is validated, scoped to the room's floor and forwarded", async () => {
    const calls: { actor: string; floorId: string; prompt: string }[] = [];
    rooms.floors.setAgentCommands({
      async spawn(actor, command) {
        calls.push({ actor: actor.id, floorId: command.floorId, prompt: command.prompt });
        return { ok: false, reason: "no free desk on this floor" };
      },
    });
    const room = await joinFloor(users.member, floorId);
    const reasons: CommandRejected[] = [];
    room.onMessage(COMMAND_REJECTED_MESSAGE, (m: CommandRejected) => reasons.push(m));
    const base = { repoId: "r1", provider: "custom", model: "m", prompt: "go" };
    room.send("agent.spawn", { ...base, floorId: otherFloorId });
    room.send("agent.spawn", { ...base, floorId, provider: "nope" });
    room.send("agent.spawn", { ...base, floorId });
    await waitFor(() => reasons.length === 3, "three rejections");
    expect(reasons.map((r) => r.reason)).toEqual([
      "wrong floor",
      expect.stringContaining("invalid agent.spawn"),
      "no free desk on this floor",
    ]);
    expect(calls).toEqual([{ actor: users.member.userId, floorId, prompt: "go" }]);
    rooms.floors.setAgentCommands(undefined);
  });

  test("floor.go in the building needs floor access", async () => {
    await rooms.refreshFloors();
    const stranger = await client(users.stranger).joinOrCreate<BuildingState>(
      ROOM_NAMES.building,
      {},
      BuildingStateSchema,
    );
    opened.push(stranger);
    await waitFor(() => stranger.state.floors.has(floorId), "floor list");
    const rejected = new Promise<CommandRejected>((resolve) =>
      stranger.onMessage(COMMAND_REJECTED_MESSAGE, (m: CommandRejected) => resolve(m)),
    );
    stranger.send("floor.go", { floorId });
    expect((await rejected).reason).toBe(`no access to floor ${floorId}`);
  });

  test("archiving a floor closes its room and drops it from the building list", async () => {
    const building = await client(users.owner).joinOrCreate<BuildingState>(
      ROOM_NAMES.building,
      {},
      BuildingStateSchema,
    );
    opened.push(building);
    const room = await joinFloor(users.owner, otherFloorId);
    const left = new Promise<number>((resolve) => room.onLeave((code) => resolve(code)));
    floors.service.archive({ id: users.owner.userId, role: "owner" }, otherFloorId);
    expect(await left).toBe(4000);
    await waitFor(() => !building.state.floors.has(otherFloorId), "building list refreshed");
    await expect(joinFloor(users.owner, otherFloorId)).rejects.toThrow(/access denied/);
  });
});
