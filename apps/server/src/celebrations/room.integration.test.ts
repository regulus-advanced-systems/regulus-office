/**
 * Merge gong over the wire (#43): a merged PR reaches the humans on its
 * repo's floor and nobody else; a bang from a client rings for everyone on
 * that floor and a second one right after is refused.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  COMMAND_REJECTED_MESSAGE,
  FloorStateSchema,
  GONG_RING_MESSAGE,
  PR_MERGED_MESSAGE,
  ROOM_NAMES,
} from "@regulus/protocol";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../db/index.ts";
import { createFloors } from "../floors/index.ts";
import { makeBareRepo } from "../floors/test-helpers.ts";
import { type AnyGitHubEvent, GitHubEventBus } from "../github/events.ts";
import { createOfficeServer, type OfficeServer } from "../http/server.ts";
import { createLogger } from "../logging.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../rooms/auth.ts";
import { createRooms, type Rooms } from "../rooms/index.ts";
import { createCelebrations } from "./service.ts";

type FloorState = InstanceType<typeof FloorStateSchema>;
const logger = createLogger({ level: "silent" });
const owner = { userId: "u-owner", displayName: "Olga", role: "owner" };
const bus = new GitHubEventBus();
let dir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
const floor = { apollo: { id: "", repoId: "" }, borealis: { id: "", repoId: "" } };
const opened: Room[] = [];

interface Heard {
  type: string;
  payload: Record<string, unknown>;
}

async function enter(floorId: string) {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: JSON.stringify(owner) },
  });
  const room = await client.joinOrCreate<FloorState>(
    ROOM_NAMES.floor,
    { floorId },
    FloorStateSchema,
  );
  opened.push(room);
  const heard: Heard[] = [];
  for (const type of [PR_MERGED_MESSAGE, GONG_RING_MESSAGE, COMMAND_REJECTED_MESSAGE]) {
    room.onMessage(type, (payload: Record<string, unknown>) => heard.push({ type, payload }));
  }
  await waitFor(() => room.state.floorId === floorId, "floor state");
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
    floorIds: [],
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
  const floors = createFloors({
    db,
    logger,
    config: { projectsDir: join(dir, "projects"), githubRemoteBase: remoteBase },
    keyring: undefined,
    onChange: (id) => void rooms.floorChanged(id),
  });
  const actor = { id: owner.userId, role: "owner" as const };
  const a = floors.service.create(actor, {
    name: "Apollo",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  const b = floors.service.create(actor, {
    name: "Borealis",
    tier: "small",
    repos: [{ repo: "octo/world" }],
  });
  await Promise.all([a.cloned, b.cloned]);
  floor.apollo = { id: a.floor.floorId, repoId: a.floor.repos[0]?.repoId ?? "" };
  floor.borealis = { id: b.floor.floorId, repoId: b.floor.repos[0]?.repoId ?? "" };
  const gong = createCelebrations({ db, floors: rooms.floors, logger });
  gong.followGitHub(bus);
  rooms.floors.setGong(gong);
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
  test("a merge reaches the floor of its repo only, once", async () => {
    const apollo = await enter(floor.apollo.id);
    const borealis = await enter(floor.borealis.id);
    bus.emit(merged([floor.apollo.repoId], 8));
    bus.emit(merged([floor.apollo.repoId], 8));
    await waitFor(() => apollo.heard.length > 0, "pr.merged on Apollo");
    await Bun.sleep(200);
    expect(apollo.heard).toEqual([
      {
        type: PR_MERGED_MESSAGE,
        payload: expect.objectContaining({
          floorId: floor.apollo.id,
          number: 8,
          title: "Oil the doors",
          url: "https://github.com/octo/hello/pull/8",
        }),
      },
    ]);
    expect(borealis.heard).toEqual([]);
  });

  test("a bang rings for everyone on the floor; a second one at once is refused", async () => {
    const mine = await enter(floor.borealis.id);
    const theirs = await enter(floor.borealis.id);
    const other = await enter(floor.apollo.id);
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
