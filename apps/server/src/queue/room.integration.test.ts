/**
 * The queue over the wire (#37): `queue.*` commands in a real FloorRoom,
 * answered with `queue.result` or `command.rejected`, and the queue and its
 * settings in `FloorState` for everyone on the floor.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, type Room } from "@colyseus/sdk";
import {
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  FloorStateSchema,
  QUEUE_RESULT_MESSAGE,
  type QueueCommandResult,
  ROOM_NAMES,
} from "@regulus/protocol";
import { createOfficeServer, type OfficeServer } from "../http/server.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../rooms/auth.ts";
import { createRooms } from "../rooms/index.ts";
import { floorQueueCommands } from "./commands.ts";
import { TaskQueue } from "./service.ts";
import { FakeSpawner, logger, roomFixture } from "./test-helpers.ts";

type FloorState = InstanceType<typeof FloorStateSchema>;

const f = roomFixture();
let server: OfficeServer;
let queue: TaskQueue;
const opened: Room[] = [];

const who = (user: { id: string; role: string }, name: string) =>
  JSON.stringify({ userId: user.id, displayName: name, role: user.role });

async function join(user: { id: string; role: string }, name: string) {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: who(user, name) },
  });
  const room = await client.joinOrCreate<FloorState>(
    ROOM_NAMES.floor,
    { floorId: f.floorId },
    FloorStateSchema,
  );
  opened.push(room);
  return room;
}

function next<T>(room: Room, type: string): Promise<T> {
  return new Promise((resolve) => {
    const off = room.onMessage(type, (payload: T) => {
      off();
      resolve(payload);
    });
  });
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

beforeAll(async () => {
  const rooms = createRooms({
    db: f.db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
  });
  queue = new TaskQueue({
    db: f.db,
    spawner: new FakeSpawner(f.db),
    publisher: rooms.floors,
    logger,
    tickIntervalMs: 60_000,
  });
  rooms.floors.setQueueCommands(floorQueueCommands(queue, () => {}));
  server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: "/nonexistent" },
    logger,
    version: "test",
    attach: rooms.transport.attachment,
  });
  await rooms.transport.listen();
});

afterAll(async () => {
  for (const room of opened) await room.leave().catch(() => {});
  await queue.close();
  await server.stop(true);
});

describe("queue commands in the FloorRoom (#37)", () => {
  test("a member queues a task; everyone on the floor sees it start", async () => {
    const member = await join(f.member, "Mia");
    const viewer = await join(f.viewer, "Vic");
    expect(member.state.queueSettings?.maxRunning).toBe(2);
    const result = next<QueueCommandResult>(member, QUEUE_RESULT_MESSAGE);
    member.send("queue.add", {
      floorId: f.floorId,
      repoId: f.repoId,
      kind: "freeform",
      prompt: "Write the release notes",
      provider: "claude-code",
      model: "opus",
    });
    const { taskId, type } = await result;
    expect(type).toBe("queue.add");
    await waitFor(
      () => viewer.state.queue.some((t) => t.id === taskId && t.state === "running"),
      "the running task on the viewer's floor",
    );
    const task = viewer.state.queue.find((t) => t.id === taskId);
    expect(task?.title).toBe("Write the release notes");
    expect(task?.ownerName).toBe("Mia");
    expect(task?.agentId).not.toBe("");
  });

  test("a viewer may not queue, a member may not change settings, a manager may", async () => {
    const viewer = await join(f.viewer, "Vic");
    const refusal = next<CommandRejected>(viewer, COMMAND_REJECTED_MESSAGE);
    viewer.send("queue.add", {
      floorId: f.floorId,
      repoId: f.repoId,
      kind: "freeform",
      prompt: "no",
      provider: "claude-code",
      model: "opus",
    });
    expect(await refusal).toMatchObject({
      type: "queue.add",
      reason: "you may not queue tasks in this room",
    });

    const member = await join(f.member, "Mia");
    const denied = next<CommandRejected>(member, COMMAND_REJECTED_MESSAGE);
    member.send("queue.settings", { maxRunning: 5, maxPerOwner: 5 });
    expect((await denied).type).toBe("queue.settings");

    const manager = await join(f.manager, "Max");
    const ok = next<QueueCommandResult>(manager, QUEUE_RESULT_MESSAGE);
    manager.send("queue.settings", { maxRunning: 1, maxPerOwner: 1 });
    expect((await ok).type).toBe("queue.settings");
    await waitFor(() => viewer.state.queueSettings?.maxRunning === 1, "the new settings");
  });
});
