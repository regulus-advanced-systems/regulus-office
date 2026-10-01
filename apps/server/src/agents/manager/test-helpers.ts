/**
 * Fixtures for AgentManager tests: an in-memory office with one operation, one
 * cloned repo (a temp dir), three desks and users with different access; a
 * recording HenchmanPublisher; and a manager factory over a LocalTmuxRunner.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, type AgentAdapter } from "@regulus/agent-adapters";
import type { HenchmanState, PendingPermission } from "@regulus/protocol";
import { desks, operationMembers, operationRepos, operations } from "../../db/schema/index.ts";
import { createLogger } from "../../logging.ts";
import { testDb } from "../../operations/test-helpers.ts";
import type { Runner } from "../../runners/types.ts";
import { AgentManager, type AgentManagerOptions, type HenchmanPublisher } from "./manager.ts";

export const FAKE_AGENT = join(import.meta.dir, "../../runners/testing/fake-agent.sh");

export class RecordingHenchmen implements HenchmanPublisher {
  readonly henchmen = new Map<string, HenchmanState>();
  readonly history: HenchmanState[] = [];
  readonly removed: string[] = [];
  /** Latest pending permission requests per henchman, as the OperationRoom would get them. */
  readonly permissions = new Map<string, PendingPermission[]>();
  readonly permissionHistory: { agentId: string; ownerUserId: string; count: number }[] = [];

  publishHenchman(_operationId: string, henchman: HenchmanState): void {
    this.henchmen.set(henchman.agentId, henchman);
    this.history.push(henchman);
  }

  removeHenchman(_operationId: string, agentId: string): void {
    this.henchmen.delete(agentId);
    this.removed.push(agentId);
  }

  publishPermissions(
    _operationId: string,
    agentId: string,
    ownerUserId: string,
    requests: PendingPermission[],
  ): void {
    this.permissions.set(agentId, requests);
    this.permissionHistory.push({ agentId, ownerUserId, count: requests.length });
  }

  async waitFor(
    agentId: string,
    ok: (r: HenchmanState) => boolean,
    ms = 5000,
  ): Promise<HenchmanState> {
    const deadline = Date.now() + ms;
    for (;;) {
      const henchman = this.henchmen.get(agentId);
      if (henchman && ok(henchman)) return henchman;
      if (Date.now() > deadline) {
        throw new Error(`henchman ${agentId} never matched; last: ${JSON.stringify(henchman)}`);
      }
      await Bun.sleep(20);
    }
  }
}

export async function officeFixture() {
  const { db, addUser } = testDb();
  const owner = addUser("Olga", "owner");
  const member = addUser("Mia", "member");
  const viewer = addUser("Vic", "member");
  const stranger = addUser("Sam", "member");
  const admin = addUser("Ada", "admin");
  /** Office role `viewer` (watch only, SPEC §8 rule 4), with view access to the operation. */
  const roleViewer = addUser("Wes", "viewer");
  const workdir = await mkdtemp(join(tmpdir(), "rgo-agents-repo-"));
  const operationId = "operation-1";
  const repoId = "repo-1";
  db.insert(operations)
    .values({
      id: operationId,
      name: "Demo",
      slug: "demo",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "t",
    })
    .run();
  db.insert(operationRepos)
    .values({
      id: repoId,
      operationId,
      owner: "octo",
      name: "hello",
      url: "file:///dev/null",
      defaultBranch: "trunk",
      workdir,
      isPrimary: true,
      cloneStatus: "ready",
    })
    .run();
  for (const seatId of ["seat-1", "seat-2", "seat-3"]) {
    db.insert(desks).values({ operationId, seatId }).run();
  }
  db.insert(operationMembers).values({ operationId, userId: member.id, access: "spawn" }).run();
  db.insert(operationMembers).values({ operationId, userId: viewer.id, access: "view" }).run();
  db.insert(operationMembers).values({ operationId, userId: roleViewer.id, access: "view" }).run();
  return { db, owner, member, viewer, stranger, admin, roleViewer, operationId, repoId, workdir };
}

export function makeManager(
  db: AgentManagerOptions["db"],
  runner: Runner,
  adapters: AgentAdapter[],
  extra: Partial<AgentManagerOptions> = {},
) {
  const henchmen = new RecordingHenchmen();
  const manager = new AgentManager({
    db,
    runner,
    adapters: new AdapterRegistry(adapters),
    henchmen,
    officeUrl: "http://office.test",
    logger: createLogger({ level: "silent" }),
    pollIntervalMs: 50,
    ...extra,
  });
  return { manager, henchmen };
}

export const spawnInput = (
  operationId: string,
  repoId: string,
  extra: Record<string, unknown> = {},
) => ({
  operationId,
  repoId,
  provider: "custom" as const,
  model: "fake-1",
  prompt: "hello henchman",
  autoWorktree: false,
  ...extra,
});
