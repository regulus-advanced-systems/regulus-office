/**
 * Merge gong over the wire (#43): a merged PR reaches the humans on its
 * repo's operation and nobody else; a bang from a client rings for everyone on
 * that operation and a second one right after is refused.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  COMMAND_REJECTED_MESSAGE,
  GONG_RING_MESSAGE,
  OperationStateSchema,
  PR_MERGED_MESSAGE,
  ROOM_NAMES,
} from "@regulus/protocol";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../db/index.ts";
import { seedRoomMember } from "../github/access/test-snapshot.ts";
import { type AnyGitHubEvent, GitHubEventBus } from "../github/events.ts";
import { createOfficeServer, type OfficeServer } from "../http/server.ts";
import { createLogger } from "../logging.ts";
import { createOperations } from "../operations/index.ts";
import { makeBareRepo } from "../operations/test-helpers.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../rooms/auth.ts";
import { createRooms, type Rooms } from "../rooms/index.ts";
import { createCelebrations } from "./service.ts";

type OperationState = InstanceType<typeof OperationStateSchema>;
const logger = createLogger({ level: "silent" });
const owner = { userId: "u-owner", displayName: "Olga", role: "owner" };
const bus = new GitHubEventBus();
let dir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
const operation = { apollo: { id: "", repoId: "" }, borealis: { id: "", repoId: "" } };
const opened: Room[] = [];

interface Heard {
  type: string;
  payload: Record<string, unknown>;
}

async function enter(operationId: string) {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: JSON.stringify(owner) },
  });
  const room = await client.joinOrCreate<OperationState>(
    ROOM_NAMES.operation,
    { operationId },
    OperationStateSchema,
  );
  opened.push(room);
  const heard: Heard[] = [];
  for (const type of [PR_MERGED_MESSAGE, GONG_RING_MESSAGE, COMMAND_REJECTED_MESSAGE]) {
    room.onMessage(type, (payload: Record<string, unknown>) => heard.push({ type, payload }));
  }
  await waitFor(() => room.state.operationId === operationId, "operation state");
  return { room, heard };
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

function merged(repoIds: string[], number: number): AnyGitHubEvent {
  return {
    name: "pull_request",
    action: "closed",
    deliveryId: `d-${number}`,
    source: "webhook",
    receivedAt: Date.now(),
    repo: { owner: "octo", name: "hello", fullName: "octo/hello" },
    repoIds,
    operationIds: [],
    installationId: null,
    sender: null,
    fromOfficeApp: false,
    stale: false,
    payload: {
      action: "closed",
      pull_request: { number, title: "Oil the doors", merged: true, merged_at: "2026-09-30" },
    },
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "office-gong-"));
  const remoteBase = await makeBareRepo(join(dir, "remotes"), "octo", "hello");
  await makeBareRepo(join(dir, "remotes"), "octo", "world");
  db = openDatabase({ path: join(dir, "office.db") });
  runMigrations(db);
  db.insert(schema.users).values({ id: owner.userId, name: "Olga", email: "o@x.test" }).run();
  db.insert(schema.userProfiles)
    .values({ userId: owner.userId, displayName: "Olga", role: "owner" })
    .run();
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
  });
  const operations = createOperations({
    db,
    logger,
    config: { projectsDir: join(dir, "projects"), githubRemoteBase: remoteBase },
    keyring: undefined,
    onChange: (id) => void rooms.operationChanged(id),
  });
  const actor = { id: owner.userId, role: "owner" as const };
  const a = operations.service.create(actor, {
    name: "Apollo",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  const b = operations.service.create(actor, {
    name: "Borealis",
    tier: "small",
    repos: [{ repo: "octo/world" }],
  });
  await Promise.all([a.cloned, b.cloned]);
  operation.apollo = { id: a.operation.operationId, repoId: a.operation.repos[0]?.repoId ?? "" };
  operation.borealis = { id: b.operation.operationId, repoId: b.operation.repos[0]?.repoId ?? "" };
  // Olga enters both rooms with her own GitHub access to their repos (#270).
  for (const { id } of [operation.apollo, operation.borealis]) {
    seedRoomMember(db, owner.userId, id, "manage");
  }
  const gong = createCelebrations({ db, operations: rooms.operations, logger });
  gong.followGitHub(bus);
  rooms.operations.setGong(gong);
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

describe("merge gong over the wire", () => {
  test("a merge reaches the operation of its repo only, once", async () => {
    const apollo = await enter(operation.apollo.id);
    const borealis = await enter(operation.borealis.id);
    bus.emit(merged([operation.apollo.repoId], 8));
    bus.emit(merged([operation.apollo.repoId], 8));
    await waitFor(() => apollo.heard.length > 0, "pr.merged on Apollo");
    await Bun.sleep(200);
    expect(apollo.heard).toEqual([
      {
        type: PR_MERGED_MESSAGE,
        payload: expect.objectContaining({
          operationId: operation.apollo.id,
          number: 8,
          title: "Oil the doors",
          url: "https://github.com/octo/hello/pull/8",
        }),
      },
    ]);
    expect(borealis.heard).toEqual([]);
  });

  test("a bang rings for everyone on the operation; a second one at once is refused", async () => {
    const mine = await enter(operation.borealis.id);
    const theirs = await enter(operation.borealis.id);
    const other = await enter(operation.apollo.id);
    mine.room.send("gong.bang", {});
    await waitFor(() => theirs.heard.length > 0, "gong.ring on the other client");
    expect(theirs.heard[0]).toEqual({
      type: GONG_RING_MESSAGE,
      payload: expect.objectContaining({ cause: "bang", strikes: 1, by: "Olga" }),
    });
    mine.room.send("gong.bang", {});
    await waitFor(() => mine.heard.some((h) => h.type === COMMAND_REJECTED_MESSAGE), "the refusal");
    expect(mine.heard.find((h) => h.type === COMMAND_REJECTED_MESSAGE)?.payload).toMatchObject({
      type: "gong.bang",
      reason: "The gong is still ringing.",
    });
    await Bun.sleep(100);
    expect(theirs.heard.filter((h) => h.type === GONG_RING_MESSAGE)).toHaveLength(1);
    expect(other.heard).toEqual([]);
  });
});
