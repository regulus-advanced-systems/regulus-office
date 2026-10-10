/**
 * TEST ONLY: the office the access tests look at (#270), in the real server
 * (./office.fixture.ts). Mia's personal level has two rooms, Alpha and
 * Bravo; the octo organisation's level has Charlie.
 *
 * - Mia (office admin) sees all three repos on GitHub.
 * - Gus (member) is a guest with read access to Alpha's repo: the issue's
 *   "guest granted repo A on someone's personal level".
 * - Olga is the office owner; her linked GitHub account sees none of them.
 * - Ned is an office admin who has not linked GitHub at all.
 *
 * Bravo and Charlie are full of things: a working henchman, a queued task,
 * a meeting, a workflow with a run, a board card, a picture, a whiteboard,
 * chat, and its task is one part of a linked task (#257): Bravo's has its other
 * part in Alpha, the room Gus may see. Every one of them carries a marker word, so "no trace" can be
 * checked by searching answers for the markers.
 */
import { eq } from "drizzle-orm";
import * as schema from "../db/schema/index.ts";
import { type Person, startTestOffice, type TestOffice, waitFor } from "./office.fixture.ts";

/** Words that only appear in what belongs to Bravo and Charlie. */
export const MARKERS = [
  "Bravo-secret",
  "bravo-secret",
  "Charlie-secret",
  "charlie-secret",
  "ZEBRA270",
  "octo-corp",
];

export interface RoomThings {
  operationId: string;
  levelId: string;
  repoId: string;
  agentId: string;
  taskId: string;
  /** The linked task (#257) the room's task is a part of. */
  linkedTaskId: string;
  /** A note its henchman left for the task's owner. */
  noteId: string;
  meetingId: string;
  workflowId: string;
  runId: string;
  decorId: string;
}

export interface Scenario {
  office: TestOffice;
  mia: Person;
  gus: Person;
  olga: Person;
  ned: Person;
  alpha: { operationId: string; levelId: string; repoId: string };
  bravo: RoomThings;
  charlie: RoomThings;
  stop(): Promise<void>;
}

function fill(
  office: TestOffice,
  room: { operationId: string; levelId: string; repoId: string },
  owner: Person,
  tag: string,
): RoomThings {
  const { db } = office;
  const { operationId, repoId } = room;
  const id = (kind: string) => `${kind}-${tag}-${crypto.randomUUID().slice(0, 8)}`;
  const agentId = crypto.randomUUID();
  db.insert(schema.agents)
    .values({
      id: agentId,
      name: `ZEBRA270-henchman-${tag}`,
      operationId,
      repoId,
      deskSeatId: "d1s1",
      ownerUserId: owner.id,
      provider: "claude-code",
      model: "m",
      profileId: "p",
      status: "waiting_input",
      workdir: "/nonexistent/270",
      taskTitle: `ZEBRA270 task of ${tag}`,
      tmuxSession: `agent-${agentId}`,
    })
    .run();
  const taskId = id("task");
  const linkedTaskId = id("linked");
  db.insert(schema.linkedTasks)
    .values({ id: linkedTaskId, title: `ZEBRA270 linked ${tag}`, createdBy: owner.id })
    .run();
  db.insert(schema.tasks)
    .values({
      id: taskId,
      linkedTaskId,
      operationId,
      repoId,
      position: 1,
      kind: "freeform",
      // Not `queued`: the queue would try to start it, and this office has no runner.
      state: "cancelled",
      title: `ZEBRA270 queued ${tag}`,
      prompt: `ZEBRA270 prompt ${tag}`,
      provider: "claude-code",
      model: "m",
      createdBy: owner.id,
    })
    .run();
  const noteId = id("note");
  db.insert(schema.linkedTaskNotes)
    .values({ id: noteId, linkedTaskId, taskId, body: `ZEBRA270 note from ${tag}` })
    .run();
  const meetingId = id("meeting");
  db.insert(schema.meetings)
    .values({
      id: meetingId,
      operationId,
      repoId,
      startedBy: owner.id,
      pattern: "debate",
      topic: `ZEBRA270 meeting ${tag}`,
      rounds: 1,
      tokenBudget: 1000,
      turnTimeoutMs: 1000,
      output: "notes",
      status: "done",
    })
    .run();
  const workflowId = id("workflow");
  db.insert(schema.workflows)
    .values({ id: workflowId, operationId, name: `ZEBRA270 workflow ${tag}`, specJson: "{}" })
    .run();
  const runId = id("run");
  db.insert(schema.workflowRuns)
    .values({
      id: runId,
      workflowId,
      operationId,
      deliveryId: id("delivery"),
      trigger: "manual",
      contextJson: "{}",
      status: "succeeded",
      provider: "claude-code",
      day: "2026-10-07",
      queuedAt: new Date(),
      summary: `ZEBRA270 run ${tag}`,
    })
    .run();
  db.insert(schema.githubIssues)
    .values({
      repoId,
      number: 7,
      title: `ZEBRA270 issue ${tag}`,
      state: "open",
      ghUpdatedAt: new Date(),
      bodyMd: `ZEBRA270 body ${tag}`,
    })
    .run();
  const decorId = id("decor");
  db.insert(schema.decor)
    .values({ id: decorId, operationId, kind: "picture", wallId: "north", x: 1, y: 1, w: 1, h: 1 })
    .run();
  db.insert(schema.whiteboards).values({ operationId, version: 3 }).run();
  db.insert(schema.chatMessages)
    .values({
      userId: owner.id,
      displayName: owner.name,
      operationId,
      text: `ZEBRA270 chat in ${tag}`,
      ts: new Date(),
    })
    .run();
  return {
    ...room,
    agentId,
    taskId,
    linkedTaskId,
    noteId,
    meetingId,
    workflowId,
    runId,
    decorId,
  };
}

export async function startScenario(): Promise<Scenario> {
  const office = await startTestOffice({
    github: [
      {
        id: 2701,
        login: "mia",
        repos: {
          "mia/alpha": "admin",
          "mia/bravo-secret": "admin",
          "octo-corp/charlie-secret": "admin",
        },
      },
      { id: 2702, login: "gus", repos: { "mia/alpha": "read" } },
      { id: 2703, login: "olga", repos: {} },
    ],
    repos: ["mia/alpha", "mia/bravo-secret", "octo-corp/charlie-secret"],
  });
  try {
    const olga = await office.signUp("Olga");
    const mia = await office.signUp("Mia");
    const gus = await office.signUp("Gus");
    const ned = await office.signUp("Ned");
    for (const admin of [mia, ned]) {
      const res = await office.call(olga, "PATCH", `/api/users/${admin.id}/role`, {
        role: "admin",
      });
      if (res.status !== 200) throw new Error(`role change failed: ${res.status}`);
    }
    await office.link(mia, "mia");
    await office.link(gus, "gus");
    await office.link(olga, "olga");

    const add = async (name: string, repo: string) => {
      const res = await office.call(mia, "POST", "/api/operations", { name, repos: [{ repo }] });
      if (res.status !== 201) throw new Error(`room ${name}: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as {
        operationId: string;
        levelId: string;
        repos: { repoId: string }[];
      };
      return {
        operationId: body.operationId,
        levelId: body.levelId,
        repoId: body.repos[0]?.repoId ?? "",
      };
    };
    const alpha = await add("Alpha", "mia/alpha");
    const bravoRoom = await add("Bravo-secret", "mia/bravo-secret");
    const charlieRoom = await add("Charlie-secret", "octo-corp/charlie-secret");
    // Creating a room refreshes everyone's snapshot for its repo: Gus gets Alpha by himself.
    await waitFor(async () => {
      const list = (await (await office.call(gus, "GET", "/api/operations")).json()) as {
        operations: { operationId: string }[];
      };
      return list.operations.some((o) => o.operationId === alpha.operationId);
    }, "Gus's snapshot to include Alpha");
    await waitFor(() => {
      const cloning = office.db
        .select({ id: schema.operationRepos.id })
        .from(schema.operationRepos)
        .where(eq(schema.operationRepos.cloneStatus, "cloning"))
        .all();
      return cloning.length === 0;
    }, "the clones");

    const bravo = fill(office, bravoRoom, mia, "bravo-secret");
    const charlie = fill(office, charlieRoom, mia, "charlie-secret");
    // The other part of Bravo's linked task, in the room Gus may see.
    office.db
      .insert(schema.tasks)
      .values({
        id: `task-alpha-${crypto.randomUUID().slice(0, 8)}`,
        linkedTaskId: bravo.linkedTaskId,
        operationId: alpha.operationId,
        repoId: alpha.repoId,
        position: 1,
        kind: "freeform",
        state: "cancelled",
        title: "Across Alpha and another room",
        prompt: "part of a linked task",
        provider: "claude-code",
        model: "m",
        createdBy: mia.id,
      })
      .run();
    return { office, mia, gus, olga, ned, alpha, bravo, charlie, stop: () => office.stop() };
  } catch (err) {
    await office.stop();
    throw err;
  }
}
