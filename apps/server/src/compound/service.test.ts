/**
 * The build state machine and the BuildingRoom publish (#181): a new room is
 * `building` for the build phase and then `ready`, also when its clone fails;
 * a restart mid-build finishes it; the layout and each room's placement and
 * build state reach the BuildingRoom state in the protocol's shape.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BuildingStateSchema,
  CompoundState,
  LOBBY_OPERATION_ID,
  OperationSummary,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { operationRepos, operations as operationsTable } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { createOperations } from "../operations/index.ts";
import { makeBareRepo, testDb } from "../operations/test-helpers.ts";
import { DrizzleOperationSource } from "../rooms/building/operations.ts";
import { createBuildingRoom } from "../rooms/building/room.ts";
import { MemoryChatStore } from "../rooms/chat/store.ts";
import type { RoomHandle } from "../rooms/transport.ts";
import type { CompoundSnapshot } from "./room-state.ts";
import { CompoundService } from "./service.ts";

const logger = createLogger({ level: "silent" });
const roots: string[] = [];
const services: CompoundService[] = [];
afterAll(async () => {
  for (const s of services) s.close();
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

async function office(buildMs: number, remote = true, now?: () => number) {
  const root = await mkdtemp(join(tmpdir(), "rg181-build-"));
  roots.push(root);
  const remoteBase = remote
    ? await makeBareRepo(join(root, "remotes"), "octo", "hello")
    : `file://${join(root, "missing")}`;
  const { db, addUser } = testDb();
  const owner = addUser("Olga", "owner");
  const ready: string[] = [];
  const snapshots: CompoundSnapshot[] = [];
  const compound = new CompoundService({
    db,
    logger,
    config: { buildMs, sizeTiles: 64 },
    now,
    publish: (s) => snapshots.push(s),
    onRoomsChanged: (ids) => ready.push(...ids),
  });
  services.push(compound);
  compound.boot();
  const operations = createOperations({
    db,
    logger,
    config: { projectsDir: join(root, "projects"), githubRemoteBase: remoteBase },
    keyring: undefined,
    placer: compound,
    onChange: (id) => compound.operationChanged(id),
  });
  return { db, owner, compound, operations, ready, snapshots };
}

const buildState = (o: Awaited<ReturnType<typeof office>>, id: string) =>
  o.db.select().from(operationsTable).where(eq(operationsTable.id, id)).get()?.buildState;

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

describe("room build phase", () => {
  test("building for the build phase, then ready; the summary says when it ends", async () => {
    const o = await office(150);
    const actor = { id: o.owner.id, role: "owner" as const };
    const t0 = Date.now();
    const { operation, cloned } = o.operations.service.create(actor, {
      name: "Apollo",
      tier: "small",
      repos: [{ repo: "octo/hello" }],
    });
    expect(buildState(o, operation.operationId)).toBe("building");
    const fields = o.compound.snapshot().rooms.get(operation.operationId);
    expect(fields?.buildState).toBe("building");
    expect(fields?.buildEndsAt).toBeGreaterThanOrEqual(t0 + 150);
    await cloned;
    await until(() => buildState(o, operation.operationId) === "ready");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
    expect(o.ready).toContain(operation.operationId);
    expect(o.compound.snapshot().rooms.get(operation.operationId)?.buildEndsAt).toBe(0);
    expect(o.compound.pendingBuilds).toBe(0);
  });

  test("a failed clone still ends the build, with the operation's clone error", async () => {
    const o = await office(60, false);
    const actor = { id: o.owner.id, role: "owner" as const };
    const { operation, cloned } = o.operations.service.create(actor, {
      name: "Broken",
      tier: "small",
      repos: [{ repo: "octo/nowhere" }],
    });
    await cloned;
    await until(() => buildState(o, operation.operationId) === "ready");
    const repo = o.db
      .select()
      .from(operationRepos)
      .where(eq(operationRepos.operationId, operation.operationId))
      .get();
    expect(repo?.cloneStatus).toBe("error");
  });

  test("a restart mid-build resumes the timer; a zero build phase is ready at once", async () => {
    // An injected clock: the build phase cannot end on its own while the
    // clone and the restart run, however slow the machine (#229).
    let clock = 1_700_000_000_000;
    const now = () => clock;
    const buildMs = 60_000;
    const o = await office(buildMs, true, now);
    const actor = { id: o.owner.id, role: "owner" as const };
    const { operation, cloned } = o.operations.service.create(actor, {
      name: "Apollo",
      tier: "small",
      repos: [{ repo: "octo/hello" }],
    });
    await cloned;
    o.compound.close();
    expect(buildState(o, operation.operationId)).toBe("building");
    // Restart with all but 20 ms of the build phase gone: the timer resumes
    // for what is left, not a fresh build phase.
    clock += buildMs - 20;
    const again = new CompoundService({
      db: o.db,
      logger,
      config: { buildMs, sizeTiles: 64 },
      now,
    });
    services.push(again);
    again.boot();
    expect(again.pendingBuilds).toBe(1);
    expect(buildState(o, operation.operationId)).toBe("building");
    await until(() => buildState(o, operation.operationId) === "ready");
    expect(again.pendingBuilds).toBe(0);

    const instant = await office(0);
    const made = instant.operations.service.create(
      { id: instant.owner.id, role: "owner" },
      { name: "Now", tier: "small", repos: [{ repo: "octo/hello" }] },
    );
    expect(buildState(instant, made.operation.operationId)).toBe("ready");
    await made.cloned;
  });
});

describe("BuildingRoom publish", () => {
  test("the layout and room fields land in the room state in the protocol's shape", async () => {
    const o = await office(60_000);
    const actor = { id: o.owner.id, role: "owner" as const };
    const made = o.operations.service.create(actor, {
      name: "Apollo",
      tier: "small",
      repos: [{ repo: "octo/hello" }],
    });
    await made.cloned;
    const room = createBuildingRoom({
      chat: new MemoryChatStore(),
      operations: new DrizzleOperationSource(o.db),
      logger,
    });
    const state = new BuildingStateSchema();
    const handle: RoomHandle<typeof state> = {
      roomId: "b",
      roomName: "building",
      state,
      clients: [],
      broadcast: () => {},
      setInterval: () => () => {},
    };
    room.setCompound(o.compound.snapshot());
    await room.onCreate?.(handle, undefined as never);
    // Only the parts this task publishes (the PM's defaults are not a valid PmState yet).
    const read = () => {
      const raw = state.toJSON() as { compound: unknown; operations: Record<string, unknown> };
      return {
        compound: CompoundState.parse(raw.compound),
        operations: Object.fromEntries(
          Object.entries(raw.operations).map(([k, v]) => [k, OperationSummary.parse(v)]),
        ),
      };
    };
    const json = read();
    expect(json.compound.width).toBe(64);
    expect(json.compound.corridors.length).toBeGreaterThan(0);
    expect(json.compound.specialRooms).toHaveLength(3);
    const apollo = json.operations[made.operation.operationId];
    expect(apollo?.buildState).toBe("building");
    expect(apollo?.gridX).toBeGreaterThanOrEqual(0);
    expect(json.operations[LOBBY_OPERATION_ID]).toMatchObject({
      gridX: 26,
      gridY: 56,
      doorSide: "north",
    });

    // A move republishes; the version changes and the entry follows.
    const before = json.compound.version;
    o.compound.move(actor, made.operation.operationId, {
      gridX: 4,
      gridY: 4,
      width: 8,
      depth: 8,
      doorSide: "east",
    });
    room.setCompound(o.compound.snapshot());
    const after = read();
    expect(after.compound.version).not.toBe(before);
    expect(after.operations[made.operation.operationId]).toMatchObject({
      gridX: 4,
      doorSide: "east",
    });
    await room.refreshOperations();
    expect(read().operations[made.operation.operationId]?.gridX).toBe(4);
  });
});
