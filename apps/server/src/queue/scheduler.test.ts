/**
 * The scheduler over a real (in-memory) database with a fake spawner:
 * slots, desks, per-owner limits, order, ownership of the spawned henchman,
 * completion and failure, and restart recovery.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { AgentManagerError } from "../agents/manager/errors.ts";
import { agents, tasks } from "../db/schema/index.ts";
import { seedRoomMember } from "../github/access/test-snapshot.ts";
import { WAIT_REASONS } from "./plan.ts";
import { FAIL_REASONS } from "./scheduler.ts";
import {
  FakeSpawner,
  freeDesk,
  freeform,
  henchmanStatus,
  makeQueue,
  roomFixture,
} from "./test-helpers.ts";

const stateOf = (q: ReturnType<typeof makeQueue>["queue"], id: string) => q.store.get(id)?.state;

describe("scheduler (#37)", () => {
  test("concurrency 1: the second task starts when the first is done", async () => {
    const f = roomFixture();
    const { queue, spawner, published } = makeQueue(f.db);
    queue.configure(f.manager, f.operationId, { maxRunning: 1, maxPerOwner: 1 });
    const a = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "first"));
    const b = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "second"));
    await queue.scheduler.idle();
    expect(stateOf(queue, a.id)).toBe("running");
    expect(stateOf(queue, b.id)).toBe("queued");
    expect(queue.store.get(b.id)?.reason).toBe(WAIT_REASONS.slot);
    expect(spawner.calls).toHaveLength(1);
    const agentA = queue.store.get(a.id)?.agentId ?? "";
    expect(agentA).toBe("agent-1");

    henchmanStatus(f.db, queue, agentA, "working", "idle");
    expect(stateOf(queue, a.id)).toBe("running");
    henchmanStatus(f.db, queue, agentA, "done", "working");
    await queue.scheduler.idle();
    expect(stateOf(queue, a.id)).toBe("done");
    expect(stateOf(queue, b.id)).toBe("running");
    expect(spawner.calls.map((c) => c.input.prompt)).toEqual(["first", "second"]);
    // The room shows both, running first then history.
    const shown = published.tasks(f.operationId);
    expect(shown.map((t) => [t.title, t.state])).toEqual([
      ["second", "running"],
      ["first", "done"],
    ]);
    expect(shown[0]?.ownerName).toBe("Mia");
  });

  test("the henchman is spawned as the task's owner with their profile, never the scheduler's", async () => {
    const f = roomFixture();
    const { queue, spawner } = makeQueue(f.db);
    queue.enqueueTask(f.member, {
      ...freeform(f.operationId, f.repoId, "mine"),
      profileId: `${f.member.id}:key`,
      permissionMode: "acceptEdits",
      effort: "high",
    });
    queue.enqueueTask(f.other, freeform(f.operationId, f.repoId, "theirs"));
    await queue.scheduler.idle();
    expect(spawner.calls.map((c) => [c.owner.id, c.input.profileId])).toEqual([
      [f.member.id, `${f.member.id}:key`],
      [f.other.id, undefined],
    ]);
    expect(spawner.calls[0]?.input).toMatchObject({
      permissionMode: "acceptEdits",
      effort: "high",
      autoWorktree: true,
      taskTitle: "mine",
    });
  });

  test("a free desk is needed; a freed desk starts the next task on the next tick", async () => {
    const f = roomFixture(1);
    const { queue } = makeQueue(f.db);
    const a = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "a"));
    const b = queue.enqueueTask(f.other, freeform(f.operationId, f.repoId, "b"));
    await queue.scheduler.idle();
    expect(queue.store.get(b.id)?.reason).toBe(WAIT_REASONS.desk);
    const agentA = queue.store.get(a.id)?.agentId ?? "";
    henchmanStatus(f.db, queue, agentA, "done", "working");
    await queue.scheduler.idle();
    // Done, but its henchman still sits at the only desk.
    expect(stateOf(queue, b.id)).toBe("queued");
    freeDesk(f.db, agentA);
    await queue.scheduler.kickAll();
    expect(stateOf(queue, b.id)).toBe("running");
  });

  test("per-owner limit lets other owners through", async () => {
    const f = roomFixture();
    const { queue } = makeQueue(f.db);
    queue.configure(f.owner, f.operationId, { maxRunning: 3, maxPerOwner: 1 });
    const a1 = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "a1"));
    const a2 = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "a2"));
    const b1 = queue.enqueueTask(f.other, freeform(f.operationId, f.repoId, "b1"));
    await queue.scheduler.idle();
    expect([a1, a2, b1].map((t) => stateOf(queue, t.id))).toEqual(["running", "queued", "running"]);
    expect(queue.store.get(a2.id)?.reason).toBe(WAIT_REASONS.owner);
  });

  test("a task whose owner lost spawn access waits, and starts once it is back", async () => {
    const f = roomFixture();
    const { queue, spawner } = makeQueue(f.db);
    queue.configure(f.owner, f.operationId, { maxRunning: 1, maxPerOwner: 1 });
    const running = queue.enqueueTask(f.other, freeform(f.operationId, f.repoId, "busy"));
    const held = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "held"));
    await queue.scheduler.idle();
    const setAccess = (access: "view" | "spawn") =>
      seedRoomMember(f.db, f.member.id, f.operationId, access);
    setAccess("view");
    henchmanStatus(f.db, queue, queue.store.get(running.id)?.agentId ?? "", "done", "working");
    await queue.scheduler.idle();
    expect(stateOf(queue, held.id)).toBe("queued");
    expect(queue.store.get(held.id)?.reason).toBe(WAIT_REASONS.access);
    expect(spawner.calls).toHaveLength(1);
    setAccess("spawn");
    await queue.scheduler.kickAll();
    expect(stateOf(queue, held.id)).toBe("running");
    expect(spawner.calls[1]?.owner.id).toBe(f.member.id);
  });

  test("reorder changes which task starts next", async () => {
    const f = roomFixture();
    const { queue, spawner } = makeQueue(f.db);
    queue.configure(f.owner, f.operationId, { maxRunning: 1, maxPerOwner: 1 });
    const first = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "first"));
    queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "second"));
    const third = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "third"));
    await queue.scheduler.idle();
    queue.reorder(f.member, f.operationId, third.id, 0);
    expect(queue.store.queued(f.operationId).map((t) => t.prompt)).toEqual(["third", "second"]);
    henchmanStatus(f.db, queue, queue.store.get(first.id)?.agentId ?? "", "done", "working");
    await queue.scheduler.idle();
    expect(spawner.calls.map((c) => c.input.prompt)).toEqual(["first", "third"]);
    // Positions stay unique per room (the unique index would throw otherwise).
    queue.reorder(f.member, f.operationId, queue.store.queued(f.operationId)[0]?.id ?? "", 5);
  });

  test("idle after working counts as done; error, exit and offline fail the task", async () => {
    const f = roomFixture();
    const { queue } = makeQueue(f.db);
    queue.configure(f.owner, f.operationId, { maxRunning: 3, maxPerOwner: 3 });
    const ids = ["a", "b", "c"].map(
      (p) => queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, p)).id,
    );
    await queue.scheduler.idle();
    const agent = (id: string) => queue.store.get(id)?.agentId ?? "";
    // Idle straight after starting is not done: the prompt is still coming.
    henchmanStatus(f.db, queue, agent(ids[0] ?? ""), "idle", "starting");
    expect(stateOf(queue, ids[0] ?? "")).toBe("running");
    henchmanStatus(f.db, queue, agent(ids[0] ?? ""), "working", "idle");
    henchmanStatus(f.db, queue, agent(ids[0] ?? ""), "idle", "working");
    henchmanStatus(f.db, queue, agent(ids[1] ?? ""), "error", "working", "runner_busy: busy");
    henchmanStatus(f.db, queue, agent(ids[2] ?? ""), "exited", "working");
    expect(ids.map((id) => [queue.store.get(id)?.state, queue.store.get(id)?.reason])).toEqual([
      ["done", ""],
      ["failed", "runner_busy: busy"],
      ["failed", FAIL_REASONS.exited],
    ]);
    // A later status of a finished task's henchman changes nothing.
    henchmanStatus(f.db, queue, agent(ids[0] ?? ""), "exited", "idle");
    expect(stateOf(queue, ids[0] ?? "")).toBe("done");
  });

  test("a refused start fails the task; a lost desk race puts it back", async () => {
    const f = roomFixture();
    const spawner = new FakeSpawner(f.db);
    const { queue } = makeQueue(f.db, spawner);
    spawner.refuse = new AgentManagerError("unavailable", "the repo is not cloned yet");
    const a = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "a"));
    await queue.scheduler.idle();
    await Bun.sleep(5);
    expect(queue.store.get(a.id)).toMatchObject({
      state: "failed",
      reason: "the repo is not cloned yet",
    });
    spawner.refuse = new AgentManagerError("conflict", "no free desk in this operation");
    const b = queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "b"));
    await queue.scheduler.idle();
    await Bun.sleep(5);
    await queue.scheduler.idle();
    expect(queue.store.get(b.id)).toMatchObject({ state: "queued", agentId: null });
    spawner.refuse = null;
    spawner.failLaunch = new AgentManagerError("failed", "the agent could not be started");
    await queue.scheduler.kickAll();
    await Bun.sleep(5);
    expect(queue.store.get(b.id)).toMatchObject({
      state: "failed",
      agentId: "agent-1",
      reason: "the agent could not be started",
    });
  });

  test("restart: queued order is kept, a start without a henchman is queued again, finished henchmen settle", async () => {
    const f = roomFixture();
    const before = makeQueue(f.db);
    before.queue.configure(f.owner, f.operationId, { maxRunning: 3, maxPerOwner: 3 });
    const ids = ["a", "b", "c"].map(
      (p) => before.queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, p)).id,
    );
    await before.queue.scheduler.idle();
    const [a, b, c] = ids as [string, string, string];
    const agentA = before.queue.store.get(a)?.agentId ?? "";
    const agentB = before.queue.store.get(b)?.agentId ?? "";
    const agentC = before.queue.store.get(c)?.agentId ?? "";
    const d = before.queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "d"));
    const e = before.queue.enqueueTask(f.member, freeform(f.operationId, f.repoId, "e"));
    await before.queue.scheduler.idle();
    await before.queue.close();
    // While the office is down: a's henchman finished and went home, b's is still
    // working, c crashed between "running" and its henchman being admitted.
    f.db.update(agents).set({ status: "done" }).where(eq(agents.id, agentA)).run();
    freeDesk(f.db, agentA);
    f.db.update(tasks).set({ agentId: null }).where(eq(tasks.id, c)).run();
    freeDesk(f.db, agentC);

    const after = makeQueue(f.db, new FakeSpawner(f.db, "-after"));
    after.queue.configure(f.owner, f.operationId, { maxRunning: 2, maxPerOwner: 3 });
    const recovered = after.queue.scheduler.recover();
    expect(recovered.has(f.operationId)).toBe(true);
    expect([a, b, c].map((id) => after.queue.store.get(id)?.state)).toEqual([
      "done",
      "running",
      "queued",
    ]);
    expect(after.queue.store.get(b)?.agentId).toBe(agentB);
    await after.queue.boot();
    // c goes first again (its old place), then d; e waits for a slot.
    expect(after.queue.store.queued(f.operationId).map((t) => t.id)).toEqual([d.id, e.id]);
    expect(after.queue.store.get(c)?.state).toBe("running");
    expect(after.published.tasks(f.operationId).length).toBeGreaterThan(0);
    await after.queue.close();
  });
});
