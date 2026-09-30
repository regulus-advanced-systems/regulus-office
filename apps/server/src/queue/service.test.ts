/**
 * The queue's server API (#37): who may queue, reorder, cancel, retry and
 * configure; what is refused up front; titles and prompts from the board
 * cache; PR linking from the office, the event bus and the cache.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { githubIssues, githubPulls } from "../db/schema/index.ts";
import { type GitHubEvent, GitHubEventBus } from "../github/events.ts";
import { QueueError } from "./service.ts";
import type { TaskRow } from "./store.ts";
import { freeform, makeQueue, robotStatus, roomFixture } from "./test-helpers.ts";

type Fixture = ReturnType<typeof roomFixture>;

function refused(fn: () => unknown, code: QueueError["code"]): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(QueueError);
    expect((err as QueueError).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} refusal`);
}

const setup = () => {
  const f = roomFixture();
  const q = makeQueue(f.db);
  // Nothing starts: keep every task queued while the ACL is exercised.
  q.queue.configure(f.owner, f.floorId, { maxRunning: 1, maxPerOwner: 1 });
  q.queue.enqueueTask(f.owner, freeform(f.floorId, f.repoId, "occupies the only slot"));
  return { f, ...q };
};

describe("enqueueTask ACL and validation (#37)", () => {
  test("spawn and manage may queue; view, strangers and other rooms may not", () => {
    const { f, queue } = setup();
    expect(queue.enqueueTask(f.member, freeform(f.floorId, f.repoId, "ok")).createdBy).toBe(
      f.member.id,
    );
    expect(queue.enqueueTask(f.manager, freeform(f.floorId, f.repoId, "ok")).createdBy).toBe(
      f.manager.id,
    );
    refused(() => queue.enqueueTask(f.viewer, freeform(f.floorId, f.repoId, "no")), "forbidden");
    refused(() => queue.enqueueTask(f.stranger, freeform(f.floorId, f.repoId, "no")), "forbidden");
    // A repo of another room.
    refused(() => queue.enqueueTask(f.member, freeform(f.floorId, "repo-2", "no")), "bad_request");
  });

  test("refuses up front what could never start", () => {
    const { f, queue } = setup();
    const base = freeform(f.floorId, f.repoId, "x");
    refused(() => queue.enqueueTask(f.member, { ...base, prompt: "  " }), "bad_request");
    refused(
      () => queue.enqueueTask(f.member, { ...base, kind: "issue", refNumber: undefined }),
      "bad_request",
    );
    refused(
      () => queue.enqueueTask(f.member, { ...base, permissionMode: "on-request" }),
      "bad_request",
    );
    // Someone else's credential profile (the spawner's check, SPEC §8).
    try {
      queue.enqueueTask(f.member, { ...base, profileId: `${f.other.id}:key` });
      throw new Error("not refused");
    } catch (err) {
      expect((err as QueueError).message).toBe("no such credential profile");
    }
  });

  test("an issue task takes its title and prompt from the board cache", () => {
    const { f, queue } = setup();
    f.db
      .insert(githubIssues)
      .values({
        repoId: f.repoId,
        number: 7,
        title: "Fix the lift doors",
        state: "open",
        ghUpdatedAt: new Date(),
        raw: JSON.stringify({ html_url: "https://github.com/octo/hello/issues/7" }),
      })
      .run();
    const task = queue.enqueueTask(f.member, {
      ...freeform(f.floorId, f.repoId, ""),
      kind: "issue",
      refNumber: 7,
    });
    expect(task.title).toBe("#7 Fix the lift doors");
    expect(task.prompt).toBe(
      "Work on issue #7 in octo/hello: Fix the lift doors\n\nhttps://github.com/octo/hello/issues/7",
    );
  });
});

describe("reorder, cancel, retry, settings (#37)", () => {
  const two = (f: Fixture, queue: ReturnType<typeof makeQueue>["queue"]): [TaskRow, TaskRow] => [
    queue.enqueueTask(f.member, freeform(f.floorId, f.repoId, "mine")),
    queue.enqueueTask(f.other, freeform(f.floorId, f.repoId, "theirs")),
  ];

  test("reorder and cancel: the owner or a room manager, nobody else", () => {
    const { f, queue } = setup();
    const [mine, theirs] = two(f, queue);
    queue.reorder(f.member, f.floorId, mine.id, 1);
    refused(() => queue.reorder(f.member, f.floorId, theirs.id, 0), "forbidden");
    refused(() => queue.reorder(f.viewer, f.floorId, theirs.id, 0), "forbidden");
    queue.reorder(f.manager, f.floorId, theirs.id, 0);
    queue.reorder(f.owner, f.floorId, theirs.id, 1);
    refused(() => queue.cancel(f.member, f.floorId, theirs.id), "forbidden");
    refused(() => queue.cancel(f.stranger, f.floorId, theirs.id), "forbidden");
    queue.cancel(f.member, f.floorId, mine.id);
    queue.cancel(f.manager, f.floorId, theirs.id);
    expect(queue.store.get(mine.id)).toMatchObject({ state: "cancelled", reason: "" });
    expect(queue.store.get(theirs.id)).toMatchObject({
      state: "cancelled",
      reason: "cancelled by a room manager",
    });
    refused(() => queue.cancel(f.member, f.floorId, mine.id), "conflict");
    // Another room's id is not found here.
    refused(() => queue.cancel(f.member, "floor-2", mine.id), "not_found");
  });

  test("retry: only the owner (their credentials), only failed or cancelled tasks", () => {
    const { f, queue } = setup();
    const [mine] = two(f, queue);
    refused(() => queue.retry(f.member, f.floorId, mine.id), "conflict");
    queue.cancel(f.manager, f.floorId, mine.id);
    refused(() => queue.retry(f.manager, f.floorId, mine.id), "forbidden");
    refused(() => queue.retry(f.other, f.floorId, mine.id), "forbidden");
    queue.retry(f.member, f.floorId, mine.id);
    expect(queue.store.get(mine.id)).toMatchObject({ state: "queued", reason: "" });
    expect(queue.store.queued(f.floorId).at(-1)?.id).toBe(mine.id);
  });

  test("cancelling a running task frees its slot and leaves its robot alone", async () => {
    const { f, queue, spawner } = setup();
    const next = queue.enqueueTask(f.member, freeform(f.floorId, f.repoId, "next"));
    await queue.scheduler.idle();
    const running = queue.store.running(f.floorId)[0];
    expect(running?.createdBy).toBe(f.owner.id);
    queue.cancel(f.manager, f.floorId, running?.id ?? "");
    await queue.scheduler.idle();
    expect(queue.store.get(next.id)?.state).toBe("running");
    // No stop was sent to the cancelled task's robot: the spawner is all the queue touches.
    expect(spawner.calls.map((c) => c.owner.id)).toEqual([f.owner.id, f.member.id]);
  });

  test("settings are for room managers and are published", () => {
    const { f, queue, published } = setup();
    refused(
      () => queue.configure(f.member, f.floorId, { maxRunning: 3, maxPerOwner: 1 }),
      "forbidden",
    );
    queue.configure(f.manager, f.floorId, { maxRunning: 3, maxPerOwner: 2 });
    expect(published.last.get(f.floorId)?.settings).toEqual({ maxRunning: 3, maxPerOwner: 2 });
  });
});

describe("PR linking (#37)", () => {
  const started = async () => {
    const f = roomFixture();
    const q = makeQueue(f.db);
    const task = q.queue.enqueueTask(f.member, freeform(f.floorId, f.repoId, "make a PR"));
    await q.queue.scheduler.idle();
    const agentId = q.queue.store.get(task.id)?.agentId ?? "";
    return { f, ...q, task, agentId };
  };

  test("a PR opened through the office is linked to the robot's task", async () => {
    const { queue, task, agentId, published, f } = await started();
    queue.observer.pullRequestOpened({ agentId } as never, { number: 12, url: "", created: true });
    expect(queue.store.get(task.id)?.prNumber).toBe(12);
    expect(published.tasks(f.floorId)[0]?.prNumber).toBe(12);
  });

  test("a pull_request event from the robot's branch links it; other branches do not", async () => {
    const { queue, task, agentId, f } = await started();
    const bus = new GitHubEventBus();
    queue.followGitHub(bus);
    const event = (ref: string, number: number, stale = false) =>
      ({
        name: "pull_request",
        action: "opened",
        repoIds: [f.repoId],
        stale,
        payload: { action: "opened", pull_request: { number, head: { ref } } },
      }) as unknown as GitHubEvent<"pull_request">;
    bus.emit(event("office/someone-else", 3));
    bus.emit(event(`office/${agentId}`, 4, true));
    expect(queue.store.get(task.id)?.prNumber).toBeNull();
    bus.emit(event(`office/${agentId}`, 5));
    expect(queue.store.get(task.id)?.prNumber).toBe(5);
  });

  test("a PR already in the board cache is linked when the robot finishes", async () => {
    const { queue, task, agentId, f } = await started();
    f.db
      .insert(githubPulls)
      .values({
        repoId: f.repoId,
        number: 9,
        title: "Robot work",
        state: "open",
        ghUpdatedAt: new Date(),
        headRef: `office/${agentId}`,
      })
      .run();
    robotStatus(f.db, queue, agentId, "done", "working");
    expect(queue.store.get(task.id)).toMatchObject({ state: "done", prNumber: 9 });
    f.db.delete(githubPulls).where(eq(githubPulls.number, 9)).run();
  });
});
