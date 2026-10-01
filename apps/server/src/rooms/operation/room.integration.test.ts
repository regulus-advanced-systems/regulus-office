/**
 * OperationRoom over the wire: one instance per operation, joins need view access,
 * desks come from the template, henchmen from the registry, archive closes the
 * room; BuildingRoom `operation.go` honours the same access rule.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  BuildingStateSchema,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  OperationStateSchema,
  ROOM_NAMES,
} from "@regulus/protocol";
import { henchmanFixture } from "@regulus/protocol/src/fixtures.ts";
import { legacyDeskCount, ROOM_LAYOUT_ID, roomDeskSeatIds } from "@regulus/room-layout";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { createOperations, type Operations } from "../../operations/index.ts";
import { makeBareRepo } from "../../operations/test-helpers.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { createRooms, type Rooms } from "../index.ts";

type OperationState = InstanceType<typeof OperationStateSchema>;
type BuildingState = InstanceType<typeof BuildingStateSchema>;

const logger = createLogger({ level: "silent" });
let dir: string;
let db: Db;
let rooms: Rooms;
let operations: Operations;
let server: OfficeServer;
let operationId: string;
let otherOperationId: string;
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

async function joinOperation(user: (typeof users)[keyof typeof users], id: string) {
  const room = await client(user).joinOrCreate<OperationState>(
    ROOM_NAMES.operation,
    { operationId: id },
    OperationStateSchema,
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
  dir = await mkdtemp(join(tmpdir(), "office-operation-room-"));
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
  operations = createOperations({
    db,
    logger,
    config: { projectsDir: join(dir, "projects"), githubRemoteBase: remoteBase },
    keyring: undefined,
    onChange: (id) => void rooms.operationChanged(id),
  });
  const owner = { id: users.owner.userId, role: "owner" as const };
  const a = operations.service.create(owner, {
    name: "Apollo",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  const b = operations.service.create(owner, {
    name: "Borealis",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  operationId = a.operation.operationId;
  otherOperationId = b.operation.operationId;
  operations.service.setMember(owner, operationId, users.member.userId, "view");
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

/** A small-tier operation is a generated room with 2 desks (#186). */
const SMALL_ROOM_SEATS = roomDeskSeatIds(legacyDeskCount("office-small") ?? 1);

describe("OperationRoom over the wire", () => {
  test("a member with view access joins and sees the operation, repos and its room's desks", async () => {
    const room = await joinOperation(users.member, operationId);
    await waitFor(() => room.state.operationId === operationId, "state");
    expect(room.state.name).toBe("Apollo");
    expect(room.state.layoutTemplateId).toBe(ROOM_LAYOUT_ID);
    expect(room.state.repos.map((r) => `${r.owner}/${r.name}@${r.defaultBranch}`)).toEqual([
      "octo/hello@trunk",
    ]);
    const seats = SMALL_ROOM_SEATS;
    expect([...room.state.desks.keys()].sort()).toEqual([...seats].sort());
    expect(room.state.henchmen.size).toBe(0);
    expect(room.state.decor.size).toBe(0);
  });

  test("the same operation shares one instance; another operation gets its own", async () => {
    const a1 = await joinOperation(users.owner, operationId);
    const a2 = await joinOperation(users.member, operationId);
    const b = await joinOperation(users.owner, otherOperationId);
    expect(a1.roomId).toBe(a2.roomId);
    expect(b.roomId).not.toBe(a1.roomId);
    await waitFor(() => b.state.name === "Borealis", "other operation state");
  });

  test("no access, unknown operations and missing options are rejected", async () => {
    await expect(joinOperation(users.stranger, operationId)).rejects.toThrow(/access denied/);
    await expect(joinOperation(users.owner, "no-such-operation")).rejects.toThrow(/access denied/);
    await expect(
      client(users.owner).joinOrCreate(ROOM_NAMES.operation, {}, OperationStateSchema),
    ).rejects.toThrow(/invalid join options/);
  });

  test("published henchmen appear (and occupy their desk) until removed", async () => {
    const room = await joinOperation(users.member, operationId);
    const seatId = SMALL_ROOM_SEATS[0] ?? "";
    rooms.operations.publishHenchman(operationId, {
      ...henchmanFixture,
      agentId: "agent-1",
      seatId,
    });
    await waitFor(() => room.state.henchmen.has("agent-1"), "henchman published");
    expect(room.state.henchmen.get("agent-1")?.status).toBe(henchmanFixture.status);
    expect(room.state.desks.get(seatId)?.agentId).toBe("agent-1");
    rooms.operations.publishHenchman(operationId, {
      ...henchmanFixture,
      agentId: "agent-1",
      seatId,
      status: "working",
    });
    await waitFor(
      () => room.state.henchmen.get("agent-1")?.status === "working",
      "henchman updated",
    );
    rooms.operations.removeHenchman(operationId, "agent-1");
    await waitFor(() => !room.state.henchmen.has("agent-1"), "henchman removed");
    expect(room.state.desks.get(seatId)?.agentId).toBe("");
    expect(() =>
      rooms.operations.publishHenchman(operationId, {
        ...henchmanFixture,
        status: "bogus" as never,
      }),
    ).toThrow();
  });

  test("board summaries reach members, whether published before or after they join", async () => {
    const repoId = operations.service.get({ id: users.owner.userId, role: "owner" }, operationId)
      ?.repos[0]?.repoId as string;
    const card = {
      repoId,
      number: 7,
      title: "Fix the lift",
      state: "open",
      labels: ["bug"],
      assignees: ["ada"],
      author: "olga",
      url: "https://github.com/octo/hello/issues/7",
      updatedAt: 1_790_000_000_000,
    };
    const pull = {
      ...card,
      number: 8,
      title: "Lift fix",
      draft: false,
      merged: false,
      headBranch: "office/lift",
      checksState: "pending" as const,
      reviewState: "review_required" as const,
    };
    rooms.operations.publishBoard(operationId, { issues: [card], pulls: [] });
    const room = await joinOperation(users.member, operationId);
    await waitFor(() => room.state.issues.has(`${repoId}#7`), "issue card");
    expect(room.state.issues.get(`${repoId}#7`)?.labels.toArray()).toEqual(["bug"]);
    rooms.operations.publishBoard(operationId, { issues: [], pulls: [pull] });
    await waitFor(
      () =>
        room.state.pulls.get(`${repoId}#8`)?.checksState === "pending" &&
        room.state.issues.size === 0,
      "pull card replaces the issue",
    );
    expect(rooms.operations.boardOn(operationId).pulls).toHaveLength(1);
    expect(() =>
      rooms.operations.publishBoard(operationId, {
        issues: [{ ...card, title: "x".repeat(301) }],
        pulls: [],
      }),
    ).toThrow();
  });

  test("a carried card is seen by everyone on the operation and goes back when its carrier leaves", async () => {
    const repoId = operations.service.get({ id: users.owner.userId, role: "owner" }, operationId)
      ?.repos[0]?.repoId as string;
    rooms.operations.publishBoard(operationId, {
      issues: [
        {
          repoId,
          number: 12,
          title: "Carry me",
          state: "open",
          labels: [],
          assignees: [],
          author: "olga",
          url: "https://github.com/octo/hello/issues/12",
          updatedAt: 1_790_000_000_000,
        },
      ],
      pulls: [],
    });
    const watcher = await joinOperation(users.member, operationId);
    const carrier = await joinOperation(users.owner, operationId);
    await waitFor(() => carrier.state.issues.has(`${repoId}#12`), "card on the board");
    const refused: CommandRejected[] = [];
    watcher.onMessage(COMMAND_REJECTED_MESSAGE, (m: CommandRejected) => refused.push(m));
    // The member only has view access: no carrying.
    watcher.send("card.pick", { cardKind: "issue", repoId, number: 12 });
    await waitFor(() => refused.length === 1, "view access refused");
    carrier.send("card.pick", { cardKind: "issue", repoId, number: 12 });
    await waitFor(() => watcher.state.carriedCards.has(carrier.sessionId), "carried card seen");
    expect(watcher.state.carriedCards.get(carrier.sessionId)?.userId).toBe(users.owner.userId);
    const seatId = SMALL_ROOM_SEATS[0] ?? "";
    carrier.send("card.drop", { seatId });
    await waitFor(() => watcher.state.carriedCards.size === 0, "dropped on a desk");
    carrier.send("card.pick", { cardKind: "issue", repoId, number: 12 });
    await waitFor(() => watcher.state.carriedCards.size === 1, "picked again");
    await carrier.leave();
    await waitFor(() => watcher.state.carriedCards.size === 0, "put back on leave");
  });

  test("operation commands are rejected until their issues land", async () => {
    const room = await joinOperation(users.member, operationId);
    const rejected = new Promise<CommandRejected>((resolve) =>
      room.onMessage(COMMAND_REJECTED_MESSAGE, (m: CommandRejected) => resolve(m)),
    );
    room.send("decor.remove", { decorId: "d1" });
    expect((await rejected).type).toBe("decor.remove");
  });

  test("agent.spawn is validated, scoped to the room's operation and forwarded", async () => {
    const calls: { actor: string; operationId: string; prompt: string }[] = [];
    rooms.operations.setAgentCommands({
      async spawn(actor, command) {
        calls.push({ actor: actor.id, operationId: command.operationId, prompt: command.prompt });
        return { ok: false, reason: "no free desk in this operation" };
      },
    });
    const room = await joinOperation(users.member, operationId);
    const reasons: CommandRejected[] = [];
    room.onMessage(COMMAND_REJECTED_MESSAGE, (m: CommandRejected) => reasons.push(m));
    const base = { repoId: "r1", provider: "custom", model: "m", prompt: "go" };
    room.send("agent.spawn", { ...base, operationId: otherOperationId });
    room.send("agent.spawn", { ...base, operationId, provider: "nope" });
    room.send("agent.spawn", { ...base, operationId });
    await waitFor(() => reasons.length === 3, "three rejections");
    expect(reasons.map((r) => r.reason)).toEqual([
      "wrong operation",
      expect.stringContaining("invalid agent.spawn"),
      "no free desk in this operation",
    ]);
    expect(calls).toEqual([{ actor: users.member.userId, operationId, prompt: "go" }]);
    rooms.operations.setAgentCommands(undefined);
  });

  test("operation.go in the building needs operation access", async () => {
    await rooms.refreshOperations();
    const stranger = await client(users.stranger).joinOrCreate<BuildingState>(
      ROOM_NAMES.building,
      {},
      BuildingStateSchema,
    );
    opened.push(stranger);
    await waitFor(() => stranger.state.operations.has(operationId), "operation list");
    const rejected = new Promise<CommandRejected>((resolve) =>
      stranger.onMessage(COMMAND_REJECTED_MESSAGE, (m: CommandRejected) => resolve(m)),
    );
    stranger.send("operation.go", { operationId });
    expect((await rejected).reason).toBe(`no access to operation ${operationId}`);
  });

  test("archiving an operation closes its room and drops it from the building list", async () => {
    const building = await client(users.owner).joinOrCreate<BuildingState>(
      ROOM_NAMES.building,
      {},
      BuildingStateSchema,
    );
    opened.push(building);
    const room = await joinOperation(users.owner, otherOperationId);
    const left = new Promise<number>((resolve) => room.onLeave((code) => resolve(code)));
    operations.service.archive({ id: users.owner.userId, role: "owner" }, otherOperationId);
    expect(await left).toBe(4000);
    await waitFor(
      () => !building.state.operations.has(otherOperationId),
      "building list refreshed",
    );
    await expect(joinOperation(users.owner, otherOperationId)).rejects.toThrow(/access denied/);
  });
});
