/**
 * One task across several repos (#257): who may create one and over which
 * rooms, what each viewer sees of it (and what they must not), how its parts
 * run, fail and stop on their own, and the draft pull requests.
 */
import { describe, expect, test } from "bun:test";
import { CreateLinkedTaskRequest } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { githubPulls, linkedTasks, operations, tasks } from "../../db/schema/index.ts";
import { seedRoomMember } from "../../github/access/test-snapshot.ts";
import { QueueError } from "../service.ts";
import { partPrompt } from "./prompt.ts";
import { NO_ROOM } from "./service.ts";
import {
  API,
  FAR,
  makeLinked,
  noCommits,
  OPS,
  officeFixture,
  repoOf,
  request,
  WEB,
} from "./test-helpers.ts";

const parse = (input: ReturnType<typeof request>) => CreateLinkedTaskRequest.parse(input);

function refusal(fn: () => unknown): QueueError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(QueueError);
    return err as QueueError;
  }
  throw new Error("expected a refusal");
}

const setup = () => {
  const f = officeFixture();
  return { f, ...makeLinked(f.db) };
};

/** A linked task over web and api, both parts started, by Ada. */
async function started() {
  const s = setup();
  const created = s.linked.create(s.f.ada, parse(request([WEB, API])));
  await s.queue.scheduler.idle();
  const [web, api] = created.taskIds.map((id) => s.queue.store.get(id));
  if (!web?.agentId || !api?.agentId) throw new Error("the parts did not start");
  return { ...s, created, webAgent: web.agentId, apiAgent: api.agentId };
}

describe("creating a linked task (#257, D34)", () => {
  test("one part per room, same owner and text, each started in its own room", async () => {
    const { f, linked, queue, spawner, store } = setup();
    const created = linked.create(f.ada, parse(request([WEB, API, OPS])));
    expect(created.taskIds).toHaveLength(3);
    const rows = store.tasksOf(created.id);
    expect(rows.map((r) => r.operationId)).toEqual([WEB, API, OPS]);
    expect(rows.map((r) => r.repoId)).toEqual([WEB, API, OPS].map(repoOf));
    expect(new Set(rows.map((r) => r.createdBy))).toEqual(new Set([f.ada.id]));
    expect(rows.every((r) => r.autoWorktree && r.kind === "freeform")).toBe(true);
    // Off unless asked for: notes are not passed on, private repos are not named.
    expect(store.get(created.id)).toMatchObject({ releaseNotes: false, namePrivateRepos: false });
    await queue.scheduler.idle();
    expect(spawner.calls.map((c) => c.input.operationId).sort()).toEqual([API, OPS, WEB].sort());
    expect(new Set(spawner.calls.map((c) => c.owner.id))).toEqual(new Set([f.ada.id]));
  });

  test("review 1: neither the henchman's prompt nor the room's queue says other repos exist", async () => {
    const { f, linked, queue, spawner, published } = setup();
    linked.create(f.ada, parse(request([WEB, API], "Add orders")));
    await queue.scheduler.idle();
    for (const call of spawner.calls) {
      expect(call.input.prompt).toBe(partPrompt("Add orders"));
      // A terminal is watched by people who may not see the other rooms.
      expect(call.input.prompt).not.toMatch(
        /octo|room-|other repos?|another repo|more than one repo|other parts?|other henchm/i,
      );
    }
    for (const room of [WEB, API]) {
      const [task] = published.tasks(room);
      expect(task?.prompt).toBe("Add orders");
    }
  });

  test("needs write access to every room; the refusal is the same for any room that is not open", () => {
    const { f, linked } = setup();
    // Bo writes in web and api only; Vic only reads; the office owner's role opens nothing.
    const cases = [
      () => linked.create(f.bo, parse(request([WEB, OPS]))),
      () => linked.create(f.bo, parse(request([WEB, "no-such-room"]))),
      () => linked.create(f.vic, parse(request([WEB, API]))),
      () => linked.create(f.boss, parse(request([WEB, API]))),
    ];
    for (const attempt of cases) {
      const err = refusal(attempt);
      expect(err.code).toBe("forbidden");
      expect(err.message).toBe(NO_ROOM);
    }
    expect(f.db.select().from(tasks).all()).toHaveLength(0);
    expect(f.db.select().from(linkedTasks).all()).toHaveLength(0);
  });

  test("a room on another level, the same room twice or one room alone is refused", () => {
    const { f, linked } = setup();
    expect(refusal(() => linked.create(f.ada, parse(request([WEB, FAR])))).code).toBe(
      "bad_request",
    );
    expect(refusal(() => linked.create(f.ada, parse(request([WEB, WEB])))).code).toBe(
      "bad_request",
    );
    expect(CreateLinkedTaskRequest.safeParse(request([WEB])).success).toBe(false);
    expect(f.db.select().from(tasks).all()).toHaveLength(0);
  });

  test("all parts are queued or none: a part its room refuses queues nothing", () => {
    const { f, linked } = setup();
    // Somebody else's credential profile: the queue refuses that part up front.
    const bad = { ...parse(request([WEB, API])), profileId: "someone-else:claude" };
    expect(refusal(() => linked.create(f.ada, bad)).code).toBe("bad_request");
    expect(f.db.select().from(tasks).all()).toHaveLength(0);
    expect(f.db.select().from(linkedTasks).all()).toHaveLength(0);
  });

  test("the task and its parts are written in one transaction: a part that fails leaves nothing", () => {
    const { f, queue, store } = setup();
    const part = queue.prepareTask(f.ada, {
      operationId: WEB,
      repoId: repoOf(WEB),
      kind: "freeform",
      prompt: "p",
      provider: "claude-code",
      model: "opus",
      linkedTaskId: "L-half",
    });
    // The second insert fails (no such room) after the first and the task's own row went in.
    const broken = { ...part, operationId: "room-gone" };
    expect(() =>
      queue.insertPrepared([part, broken], (tx) =>
        store.create(tx, {
          id: "L-half",
          title: "t",
          createdBy: f.ada.id,
          namePrivateRepos: false,
        }),
      ),
    ).toThrow();
    expect(f.db.select().from(tasks).all()).toHaveLength(0);
    expect(f.db.select().from(linkedTasks).all()).toHaveLength(0);
  });
});

describe("what a viewer sees (#257, D26, D27)", () => {
  test("everyone who sees two parts sees the task with those parts", async () => {
    const { f, linked, created } = await started();
    for (const viewer of [f.ada, f.bo, f.vic]) {
      const [view] = linked.list(viewer, WEB);
      expect(view?.id).toBe(created.id);
      expect(view?.parts.map((p) => p.operationId)).toEqual([WEB, API]);
      expect(view?.parts.map((p) => p.repo)).toEqual(["octo/web", "octo/api"]);
      expect(view?.work).toBe("working");
      expect(view?.mayStop).toBe(viewer.id === f.ada.id);
    }
  });

  test("with one visible part the task is an ordinary task: no view, from any room", async () => {
    const { f, linked } = await started();
    // Wes sees web only.
    expect(linked.list(f.wes, WEB)).toEqual([]);
    // A room he cannot see, a room that does not exist and a room without linked tasks answer alike.
    expect(linked.list(f.wes, API)).toEqual([]);
    expect(linked.list(f.wes, "no-such-room")).toEqual([]);
    expect(linked.list(f.wes, OPS)).toEqual([]);
    expect(linked.list(f.boss, WEB)).toEqual([]);
  });

  test("a three-room task shows two parts to someone who sees two rooms, and counts only those", async () => {
    const { f, linked, queue, store, published, status } = setup();
    const created = linked.create(f.ada, parse(request([WEB, API, OPS])));
    await queue.scheduler.idle();
    // The hidden part fails; the two visible ones finish with merged pull requests.
    for (const row of store.tasksOf(created.id)) {
      if (!row.agentId) throw new Error("not started");
      if (row.operationId === OPS) {
        status(row.agentId, "error", "working");
        continue;
      }
      status(row.agentId, "done", "working");
      queue.linkPullRequest(row.agentId, 7);
      f.db
        .insert(githubPulls)
        .values({
          repoId: repoOf(row.operationId),
          number: 7,
          title: "t",
          state: "closed",
          ghUpdatedAt: new Date(),
          raw: JSON.stringify({ merged: true, html_url: "https://github.com/x/y/pull/7" }),
        })
        .run();
    }
    await linked.idle();
    const [bo] = linked.list(f.bo, WEB);
    expect(bo?.parts.map((p) => p.operationId)).toEqual([WEB, API]);
    expect(bo?.work).toBe("finished");
    expect(bo?.pulls).toBe("all_merged");
    const text = JSON.stringify(bo);
    for (const hidden of [OPS, "ops", repoOf(OPS), "error"]) expect(text).not.toContain(hidden);
    // Ada sees all three, and that one failed.
    const [ada] = linked.list(f.ada, WEB);
    expect(ada?.parts).toHaveLength(3);
    expect(ada?.work).toBe("attention");
    expect(ada?.pulls).toBe("some_merged");
    // Nothing in a room's live state says a task is linked.
    for (const room of [WEB, API, OPS]) {
      const state = JSON.stringify(published.tasks(room));
      expect(state).not.toContain(created.id);
      expect(state).not.toContain("linked");
    }
  });

  test("losing a room hides its part again, also from the task's owner", async () => {
    const { f, linked } = await started();
    seedRoomMember(f.db, f.bo.id, API, null);
    expect(linked.list(f.bo, WEB)).toEqual([]);
    seedRoomMember(f.db, f.ada.id, API, null);
    expect(linked.list(f.ada, WEB)).toEqual([]);
  });

  test("an archived room's part is not shown", async () => {
    const { f, linked } = await started();
    f.db.update(operations).set({ archivedAt: new Date() }).where(eq(operations.id, API)).run();
    expect(linked.list(f.ada, WEB)).toEqual([]);
  });
});

describe("parts run on their own (#257)", () => {
  test("a failed part is shown on the task; the other carries on", async () => {
    const { f, linked, queue, webAgent, apiAgent, created, status } = await started();
    status(apiAgent, "error", "working", "the model refused");
    const [view] = linked.list(f.ada, WEB);
    expect(view?.parts.map((p) => p.state)).toEqual(["running", "failed"]);
    expect(view?.parts[1]?.reason).toBe("the model refused");
    expect(view?.work).toBe("working");
    expect(queue.store.runningFor(webAgent)?.linkedTaskId).toBe(created.id);
  });

  test("a room manager cancels the part in their room only", async () => {
    const { f, linked, queue, created } = await started();
    const [webTask] = created.taskIds;
    queue.cancel(f.wes, WEB, webTask as string);
    const [view] = linked.list(f.ada, WEB);
    expect(view?.parts.map((p) => p.state)).toEqual(["cancelled", "running"]);
    expect(view?.mayStop).toBe(true);
  });

  /** Web running, api queued behind another task of Ada's. */
  async function oneRunningOneQueued() {
    const s = setup();
    seedRoomMember(s.f.db, s.f.ada.id, API, "manage");
    s.queue.configure(s.f.ada, API, { maxRunning: 1, maxPerOwner: 1 });
    s.queue.enqueueTask(s.f.ada, {
      operationId: API,
      repoId: repoOf(API),
      kind: "freeform",
      prompt: "occupies the slot",
      provider: "claude-code",
      model: "opus",
    });
    const created = s.linked.create(s.f.ada, parse(request([WEB, API])));
    await s.queue.scheduler.idle();
    expect(s.store.tasksOf(created.id).map((t) => t.state)).toEqual(["running", "queued"]);
    return { ...s, created, webAgent: s.store.tasksOf(created.id)[0]?.agentId as string };
  }

  test("only the owner stops the whole task", async () => {
    const { f, linked, henchmen, created } = await oneRunningOneQueued();
    for (const other of [f.bo, f.vic, f.wes, f.boss]) {
      const err = await linked.stop(other, created.id).catch((e: unknown) => e);
      expect((err as QueueError).code).toBe("not_found");
    }
    expect(((await linked.stop(f.ada, "nope").catch((e: unknown) => e)) as QueueError).code).toBe(
      "not_found",
    );
    expect(henchmen.stopped).toEqual([]);
  });

  test("stopping: queued parts are cancelled, a running part once its henchman has stopped", async () => {
    const { f, linked, henchmen, store, created, webAgent } = await oneRunningOneQueued();
    // While the henchman is being stopped the part is not cancelled yet.
    let duringStop = "";
    const exit = henchmen.onStop;
    henchmen.onStop = (agentId) => {
      duringStop = store.tasksOf(created.id)[0]?.state ?? "";
      exit(agentId);
    };
    expect(await linked.stop(f.ada, created.id)).toEqual({
      id: created.id,
      stopped: 2,
      refused: 0,
    });
    expect(duringStop).toBe("running");
    expect(henchmen.stopped).toEqual([webAgent]);
    // The henchman's exit had marked the part failed; the owner's stop makes it cancelled.
    expect(store.tasksOf(created.id).map((t) => t.state)).toEqual(["cancelled", "cancelled"]);
    expect(linked.list(f.ada, WEB)[0]?.mayStop).toBe(false);
  });

  test("a henchman that cannot be stopped is not counted as stopped, and its part carries on", async () => {
    const { f, linked, henchmen, store, created, webAgent } = await oneRunningOneQueued();
    henchmen.unstoppable.add(webAgent);
    expect(await linked.stop(f.ada, created.id)).toEqual({
      id: created.id,
      stopped: 1,
      refused: 1,
    });
    expect(store.tasksOf(created.id).map((t) => t.state)).toEqual(["running", "cancelled"]);
    expect(linked.list(f.ada, WEB)[0]?.mayStop).toBe(true);
  });

  test("a finished part is left as it is when the task is stopped", async () => {
    const { f, linked, henchmen, store, created, webAgent, status } = await oneRunningOneQueued();
    status(webAgent, "done", "working");
    await linked.idle();
    expect((await linked.stop(f.ada, created.id)).stopped).toBe(1);
    expect(henchmen.stopped).toEqual([]);
    expect(store.tasksOf(created.id).map((t) => t.state)).toEqual(["done", "cancelled"]);
  });

  test("review 6: a stopped part's reason in the room's queue says nothing of a larger task", async () => {
    const { f, linked, published, store, created } = await oneRunningOneQueued();
    await linked.stop(f.ada, created.id);
    for (const part of store.tasksOf(created.id)) {
      expect(part.reason).toBe("");
      const shown = published.tasks(part.operationId).find((t) => t.id === part.id);
      expect(shown?.state).toBe("cancelled");
      expect(shown?.reason).toBe("");
    }
    // Everyone in a room reads its queue: no word of a whole, of parts or of other rooms.
    for (const room of [WEB, API]) {
      expect(JSON.stringify(published.tasks(room))).not.toMatch(/whole|part|other|linked/i);
    }
  });
});

describe("draft pull requests (#257)", () => {
  test("a finished part gets a draft pull request, opened as the task's owner", async () => {
    const { f, linked, queue, henchmen, webAgent, apiAgent, status } = await started();
    henchmen.onDraft = (agentId) => queue.linkPullRequest(agentId, agentId === webAgent ? 11 : 12);
    status(webAgent, "done", "working");
    await linked.idle();
    expect(henchmen.drafts).toEqual([{ owner: f.ada.id, agentId: webAgent }]);
    let [view] = linked.list(f.ada, WEB);
    expect(view?.parts.map((p) => p.prNumber)).toEqual([11, 0]);
    expect(view?.parts[0]?.prUrl).toBe("https://github.com/octo/web/pull/11");
    expect(view?.pulls).toBe("some_open");
    status(apiAgent, "done", "working");
    await linked.idle();
    [view] = linked.list(f.ada, WEB);
    expect(view?.pulls).toBe("all_open");
    expect(view?.work).toBe("finished");
    // Later turns of a part that has its pull request open no second one.
    status(webAgent, "working", "done");
    status(webAgent, "idle", "working");
    await linked.idle();
    expect(henchmen.drafts).toHaveLength(2);
  });

  test("a part that stopped with no commits says why, and gets its pull request when commits arrive", async () => {
    const { f, linked, queue, henchmen, webAgent, status } = await started();
    henchmen.refuse.set(webAgent, noCommits());
    // It went idle to ask something: the queue calls that done; there is nothing to open yet.
    status(webAgent, "idle", "working");
    await linked.idle();
    expect(henchmen.drafts).toEqual([]);
    expect(linked.list(f.ada, WEB)[0]?.parts[0]?.prNote).toBe("office/x has no commits");
    // The owner answers, the henchman commits and ends its turn again.
    henchmen.refuse.clear();
    henchmen.onDraft = (agentId) => queue.linkPullRequest(agentId, 5);
    status(webAgent, "working", "idle");
    status(webAgent, "idle", "working");
    await linked.idle();
    expect(henchmen.drafts).toEqual([{ owner: f.ada.id, agentId: webAgent }]);
    const part = linked.list(f.ada, WEB)[0]?.parts[0];
    expect(part).toMatchObject({ prNumber: 5, prNote: "" });
  });

  test("a part without a pull request is tried again at boot, whatever was noted before", async () => {
    const { f, linked, henchmen, webAgent, status, created } = await started();
    henchmen.refuse.set(webAgent, noCommits());
    status(webAgent, "done", "working");
    await linked.idle();
    henchmen.refuse.clear();
    linked.recover();
    await linked.idle();
    expect(henchmen.drafts).toEqual([{ owner: f.ada.id, agentId: webAgent }]);
    // A linked task goes only once its last part is gone.
    expect(
      f.db
        .select()
        .from(linkedTasks)
        .all()
        .map((l) => l.id),
    ).toEqual([created.id]);
    f.db.delete(tasks).run();
    linked.recover();
    expect(f.db.select().from(linkedTasks).all()).toEqual([]);
  });

  test("an unexpected failure is not shown in detail", async () => {
    const { f, linked, henchmen, webAgent, status } = await started();
    henchmen.refuse.set(webAgent, new Error("ECONNRESET ghp_abcdefgh12345678 /srv/office/x"));
    status(webAgent, "done", "working");
    await linked.idle();
    expect(linked.list(f.ada, WEB)[0]?.parts[0]?.prNote).toBe(
      "the pull request could not be opened",
    );
  });
});
