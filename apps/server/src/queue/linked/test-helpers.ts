/**
 * Fixtures for linked task tests (#257): an office with three rooms on one
 * level (web, api, ops), one on another level (far), people whose GitHub
 * access covers different rooms, and fakes for the henchmen and GitHub.
 *
 * The migrations run once per test file: every test gets a copy of the
 * migrated, empty database, so a test costs milliseconds also on a busy
 * machine. Nothing here waits on a real timer.
 */
import { Database } from "bun:sqlite";
import type { AgentStatus, UserRole } from "@regulus/protocol";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { AgentManagerError } from "../../agents/manager/errors.ts";
import type { AgentView } from "../../agents/manager/henchman.ts";
import { type Db, MEMORY_DB_PATH, openDatabase, runMigrations, schema } from "../../db/index.ts";
import {
  desks,
  levels,
  operationRepos,
  operations,
  userProfiles,
  users,
} from "../../db/schema/index.ts";
import { seedRoomMember } from "../../github/access/test-snapshot.ts";
import { type OperationActor, operationAccessFor } from "../../operations/access.ts";
import { FakeSpawner, henchmanStatus, logger, makeQueue } from "../test-helpers.ts";
import { NotesSync, type openOfficeDir } from "./notes.ts";
import { PullLinker, type PullPage, type PullPages } from "./pull-links.ts";
import { type LinkedHenchmen, LinkedTasks } from "./service.ts";
import { LinkedTaskStore } from "./store.ts";

export const WEB = "room-web";
export const API = "room-api";
export const OPS = "room-ops";
export const FAR = "room-far";
export const ROOMS = [WEB, API, OPS, FAR] as const;
export const repoOf = (operationId: string) => `repo-of-${operationId}`;

let migrated: Uint8Array | undefined;

/** A migrated, empty in-memory database: a copy of one made once. */
export function freshDb(): Db {
  if (!migrated) {
    const first = openDatabase({ path: MEMORY_DB_PATH });
    runMigrations(first);
    migrated = first.$client.serialize();
    first.$client.close();
  }
  const client = Database.deserialize(migrated, { strict: true });
  client.run("PRAGMA foreign_keys = ON");
  return drizzle({ client, schema });
}

export function addRoom(db: Db, id: string, owner: string, levelId: string, seats = 2): void {
  const name = id.replace("room-", "");
  db.insert(operations)
    .values({ id, name, slug: id, levelId, index: 1, paletteId: "oak-sky", layoutTemplateId: "t" })
    .run();
  db.insert(operationRepos)
    .values({
      id: repoOf(id),
      operationId: id,
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
      defaultBranch: "main",
      workdir: "/tmp/none",
      isPrimary: true,
      cloneStatus: "ready",
    })
    .run();
  for (let i = 1; i <= seats; i++)
    db.insert(desks)
      .values({ operationId: id, seatId: `seat-${i}` })
      .run();
}

export function officeFixture() {
  const db = freshDb();
  let seq = 0;
  const addUser = (displayName: string, role: UserRole) => {
    seq += 1;
    const id = `user-${seq}`;
    db.insert(users)
      .values({ id, name: displayName, email: `${id}@example.com`, emailVerified: false })
      .run();
    db.insert(userProfiles).values({ userId: id, displayName, role }).run();
    return { id, role };
  };
  for (const [id, login, position] of [
    ["level-octo", "octo", 1],
    ["level-acme", "acme", 2],
  ] as const) {
    db.insert(levels).values({ id, kind: "org", login, name: login, position }).run();
  }
  addRoom(db, WEB, "octo", "level-octo");
  addRoom(db, API, "octo", "level-octo");
  addRoom(db, OPS, "octo", "level-octo");
  addRoom(db, FAR, "acme", "level-acme");
  /** Writes everywhere. */
  const ada = addUser("Ada", "member");
  /** Writes in web and api, sees nothing else. */
  const bo = addUser("Bo", "member");
  /** Reads web and api. */
  const vic = addUser("Vic", "member");
  /** Sees web only; manages it. */
  const wes = addUser("Wes", "member");
  /** The office owner, whose GitHub account sees no repo. */
  const boss = addUser("Boss", "owner");
  for (const room of ROOMS) seedRoomMember(db, ada.id, room, "spawn");
  for (const room of [WEB, API]) {
    seedRoomMember(db, bo.id, room, "spawn");
    seedRoomMember(db, vic.id, room, "view");
  }
  seedRoomMember(db, wes.id, WEB, "manage");
  return { db, ada, bo, vic, wes, boss };
}

export class FakeHenchmen implements LinkedHenchmen {
  readonly drafts: { owner: string; agentId: string }[] = [];
  readonly stopped: string[] = [];
  /** Refusals per henchman (no commits, uncommitted files...). */
  readonly refuse = new Map<string, Error>();
  /** Henchmen that may not be stopped. */
  readonly unstoppable = new Set<string>();
  onDraft: (agentId: string) => void = () => {};
  /** What a stop does to the office: the henchman's exit reaches the queue. */
  onStop: (agentId: string) => void = () => {};

  async openDraftPullRequest(owner: OperationActor, agentId: string): Promise<unknown> {
    const refusal = this.refuse.get(agentId);
    if (refusal) throw refusal;
    this.drafts.push({ owner: owner.id, agentId });
    this.onDraft(agentId);
    return {};
  }

  async stop(_owner: OperationActor, agentId: string): Promise<void> {
    if (this.unstoppable.has(agentId)) {
      throw new AgentManagerError("forbidden", "you can no longer work in this room");
    }
    this.stopped.push(agentId);
    this.onStop(agentId);
  }
}

export const noCommits = () => new AgentManagerError("conflict", "office/x has no commits");

/** Pull request pages in memory, keyed `repoId#number`. */
export class FakePages implements PullPages {
  readonly pages = new Map<string, PullPage>();
  readonly writes: { key: string; body: string }[] = [];
  /** Keys whose read or write fails. */
  readonly brokenRead = new Set<string>();
  readonly brokenWrite = new Set<string>();

  put(repoId: string, number: number, page: Partial<PullPage> & { repo: string }): void {
    this.pages.set(`${repoId}#${number}`, {
      body: "",
      url: `https://github.com/${page.repo}/pull/${number}`,
      isPrivate: true,
      ...page,
    });
  }

  async read(repoId: string, number: number): Promise<PullPage | null> {
    if (this.brokenRead.has(`${repoId}#${number}`)) throw new Error("read failed");
    return this.pages.get(`${repoId}#${number}`) ?? null;
  }

  async writeBody(repoId: string, number: number, body: string): Promise<void> {
    const key = `${repoId}#${number}`;
    if (this.brokenWrite.has(key)) throw new Error("write failed");
    const page = this.pages.get(key);
    if (page) this.pages.set(key, { ...page, body });
    this.writes.push({ key, body });
  }

  body(repoId: string, number: number): string {
    return this.pages.get(`${repoId}#${number}`)?.body ?? "";
  }
}

export function makeLinked(
  db: Db,
  opts: {
    worktreesDir?: string;
    roundTimeoutMs?: number;
    openOfficeDir?: typeof openOfficeDir;
  } = {},
) {
  const spawner = new FakeSpawner(db);
  const { queue, published } = makeQueue(db, spawner);
  const store = new LinkedTaskStore(db);
  const henchmen = new FakeHenchmen();
  const pages = new FakePages();
  const pulls = new PullLinker({ store, pages, logger });
  const notes = new NotesSync({
    store,
    worktreesDir: opts.worktreesDir ?? "/nonexistent/worktrees",
    ownerMayAccess: (userId, operationId) => {
      const owner = queue.scheduler.ownerActor(userId);
      return owner !== null && operationAccessFor(db, owner, operationId) !== null;
    },
    logger,
    ...(opts.roundTimeoutMs ? { roundTimeoutMs: opts.roundTimeoutMs } : {}),
    ...(opts.openOfficeDir ? { openOfficeDir: opts.openOfficeDir } : {}),
  });
  const linked = new LinkedTasks({ store, queue, henchmen, notes, pulls, logger });
  queue.extend(linked.hooks);
  /** A henchman's status change, as the AgentManager tells its observers: the queue, then the linked tasks. */
  const status = (agentId: string, to: AgentStatus, from: AgentStatus, reason = "") => {
    henchmanStatus(db, queue, agentId, to, from, reason);
    linked.observer.statusChanged({ agentId, status: to, statusReason: reason } as AgentView, from);
  };
  henchmen.onStop = (agentId) => status(agentId, "exited", "working");
  return { queue, published, spawner, store, henchmen, pages, pulls, notes, linked, status };
}

export const request = (operationIds: string[], prompt = "Add orders to the API and the page") => ({
  operationIds,
  prompt,
  provider: "claude-code" as const,
  model: "opus",
});
