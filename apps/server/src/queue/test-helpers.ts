/**
 * Fixtures for task queue tests (#37): an in-memory office with one room
 * (repo, desks, members of each access level) and a fake spawner that admits
 * henchmen the way the AgentManager does (agent row + desk claim, synchronously
 * inside `spawn`) without running anything.
 */
import type { AgentStatus, QueueSettings, QueueTask } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { AgentManagerError } from "../agents/manager/errors.ts";
import type { AgentView } from "../agents/manager/henchman.ts";
import type { SpawnInput } from "../agents/manager/spawn.ts";
import { AgentStore } from "../agents/manager/store.ts";
import type { Db } from "../db/index.ts";
import { agents, desks, operationMembers, operationRepos, operations } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import type { OperationActor } from "../operations/access.ts";
import { testDb } from "../operations/test-helpers.ts";
import type { QueueSpawner } from "./scheduler.ts";
import { type QueuePublisher, TaskQueue } from "./service.ts";

export const logger = createLogger({ level: "silent" });

export function roomFixture(seats = 3) {
  const { db, addUser } = testDb();
  const owner = addUser("Olga", "owner");
  const member = addUser("Mia", "member");
  const other = addUser("Otto", "member");
  const manager = addUser("Max", "member");
  const viewer = addUser("Vic", "member");
  const stranger = addUser("Sam", "member");
  const operationId = "operation-1";
  const repoId = "repo-1";
  for (const [id, name] of [
    [operationId, "Apollo"],
    ["operation-2", "Borealis"],
  ] as const) {
    db.insert(operations)
      .values({ id, name, slug: id, index: 1, paletteId: "oak-sky", layoutTemplateId: "t" })
      .run();
  }
  for (const [id, fid] of [
    [repoId, operationId],
    ["repo-2", "operation-2"],
  ] as const) {
    db.insert(operationRepos)
      .values({
        id,
        operationId: fid,
        owner: "octo",
        name: id === repoId ? "hello" : "other",
        url: "file:///dev/null",
        defaultBranch: "trunk",
        workdir: "/tmp/none",
        isPrimary: true,
        cloneStatus: "ready",
      })
      .run();
  }
  for (let i = 1; i <= seats; i++)
    db.insert(desks)
      .values({ operationId, seatId: `seat-${i}` })
      .run();
  const access = [
    [member, "spawn"],
    [other, "spawn"],
    [manager, "manage"],
    [viewer, "view"],
  ] as const;
  for (const [user, level] of access) {
    db.insert(operationMembers).values({ operationId, userId: user.id, access: level }).run();
  }
  return { db, owner, member, other, manager, viewer, stranger, operationId, repoId };
}

export class FakeSpawner implements QueueSpawner {
  readonly calls: { owner: OperationActor; input: SpawnInput; agentId?: string }[] = [];
  /** Thrown before admission (the manager refused: access, desk, repo...). */
  refuse: AgentManagerError | null = null;
  /** Thrown after admission (the launch failed; the henchman sits in `error`). */
  failLaunch: AgentManagerError | null = null;
  #n = 0;

  /** Distinguishes henchmen of a second spawner over the same database (restart tests). */
  constructor(
    readonly db: Db,
    readonly suffix = "",
  ) {}

  check(owner: OperationActor, input: SpawnInput): void {
    if (input.profileId && !input.profileId.startsWith(`${owner.id}:`)) {
      throw new AgentManagerError("bad_request", "no such credential profile");
    }
  }

  async spawn(owner: OperationActor, input: SpawnInput, hooks: { onAdmitted(id: string): void }) {
    const call: (typeof this.calls)[number] = { owner, input };
    this.calls.push(call);
    if (this.refuse) throw this.refuse;
    this.#n += 1;
    const agentId = `agent-${this.#n}${this.suffix}`;
    new AgentStore(this.db).insertWithDesk(
      {
        id: agentId,
        operationId: input.operationId,
        repoId: input.repoId,
        deskSeatId: "",
        ownerUserId: owner.id,
        provider: input.provider,
        model: input.model,
        profileId: input.profileId ?? `login:${input.provider}`,
        status: "starting",
        tmuxSession: `agent-${agentId}`,
        workdir: "/tmp/none",
        worktreeBranch: `office/${agentId}`,
        taskTitle: input.taskTitle ?? "",
      },
      undefined,
    );
    call.agentId = agentId;
    hooks.onAdmitted(agentId);
    await Bun.sleep(1);
    if (this.failLaunch) throw this.failLaunch;
    return { agentId };
  }
}

export class RecordingQueue implements QueuePublisher {
  readonly last = new Map<string, { tasks: readonly QueueTask[]; settings: QueueSettings }>();
  publishQueue(operationId: string, tasks: readonly QueueTask[], settings: QueueSettings): void {
    this.last.set(operationId, { tasks, settings });
  }
  tasks(operationId: string): readonly QueueTask[] {
    return this.last.get(operationId)?.tasks ?? [];
  }
}

export function makeQueue(db: Db, spawner = new FakeSpawner(db)) {
  const published = new RecordingQueue();
  const queue = new TaskQueue({
    db,
    spawner,
    publisher: published,
    logger,
    tickIntervalMs: 60_000,
  });
  return { queue, spawner, published };
}

/** Tell the queue a henchman's status changed, as the AgentManager does. */
export function henchmanStatus(
  db: Db,
  queue: TaskQueue,
  agentId: string,
  status: AgentStatus,
  previous: AgentStatus,
  statusReason = "",
): void {
  db.update(agents).set({ status }).where(eq(agents.id, agentId)).run();
  queue.observer.statusChanged({ agentId, status, statusReason } as AgentView, previous);
}

/** Free a henchman's desk, as sending it home does. */
export function freeDesk(db: Db, agentId: string): void {
  db.update(desks).set({ agentId: null }).where(eq(desks.agentId, agentId)).run();
}

export const freeform = (operationId: string, repoId: string, prompt: string) => ({
  operationId,
  repoId,
  kind: "freeform" as const,
  prompt,
  provider: "claude-code" as const,
  model: "opus",
});
