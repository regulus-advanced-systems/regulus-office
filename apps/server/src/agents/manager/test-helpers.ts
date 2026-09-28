/**
 * Fixtures for AgentManager tests: an in-memory office with one floor, one
 * cloned repo (a temp dir), three desks and users with different access; a
 * recording RobotPublisher; and a manager factory over a LocalTmuxRunner.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, type AgentAdapter } from "@regulus/agent-adapters";
import type { PendingPermission, RobotState } from "@regulus/protocol";
import { desks, floorMembers, floorRepos, floors } from "../../db/schema/index.ts";
import { testDb } from "../../floors/test-helpers.ts";
import { createLogger } from "../../logging.ts";
import type { Runner } from "../../runners/types.ts";
import { AgentManager, type AgentManagerOptions, type RobotPublisher } from "./manager.ts";

export const FAKE_AGENT = join(import.meta.dir, "../../runners/testing/fake-agent.sh");

export class RecordingRobots implements RobotPublisher {
  readonly robots = new Map<string, RobotState>();
  readonly history: RobotState[] = [];
  readonly removed: string[] = [];
  /** Latest pending permission requests per robot, as the FloorRoom would get them. */
  readonly permissions = new Map<string, PendingPermission[]>();
  readonly permissionHistory: { agentId: string; ownerUserId: string; count: number }[] = [];

  publishRobot(_floorId: string, robot: RobotState): void {
    this.robots.set(robot.agentId, robot);
    this.history.push(robot);
  }

  removeRobot(_floorId: string, agentId: string): void {
    this.robots.delete(agentId);
    this.removed.push(agentId);
  }

  publishPermissions(
    _floorId: string,
    agentId: string,
    ownerUserId: string,
    requests: PendingPermission[],
  ): void {
    this.permissions.set(agentId, requests);
    this.permissionHistory.push({ agentId, ownerUserId, count: requests.length });
  }

  async waitFor(agentId: string, ok: (r: RobotState) => boolean, ms = 5000): Promise<RobotState> {
    const deadline = Date.now() + ms;
    for (;;) {
      const robot = this.robots.get(agentId);
      if (robot && ok(robot)) return robot;
      if (Date.now() > deadline) {
        throw new Error(`robot ${agentId} never matched; last: ${JSON.stringify(robot)}`);
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
  /** Office role `viewer` (watch only, SPEC §8 rule 4), with view access to the floor. */
  const roleViewer = addUser("Wes", "viewer");
  const workdir = await mkdtemp(join(tmpdir(), "rgo-agents-repo-"));
  const floorId = "floor-1";
  const repoId = "repo-1";
  db.insert(floors)
    .values({
      id: floorId,
      name: "Demo",
      slug: "demo",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "t",
    })
    .run();
  db.insert(floorRepos)
    .values({
      id: repoId,
      floorId,
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
    db.insert(desks).values({ floorId, seatId }).run();
  }
  db.insert(floorMembers).values({ floorId, userId: member.id, access: "spawn" }).run();
  db.insert(floorMembers).values({ floorId, userId: viewer.id, access: "view" }).run();
  db.insert(floorMembers).values({ floorId, userId: roleViewer.id, access: "view" }).run();
  return { db, owner, member, viewer, stranger, admin, roleViewer, floorId, repoId, workdir };
}

export function makeManager(
  db: AgentManagerOptions["db"],
  runner: Runner,
  adapters: AgentAdapter[],
  extra: Partial<AgentManagerOptions> = {},
) {
  const robots = new RecordingRobots();
  const manager = new AgentManager({
    db,
    runner,
    adapters: new AdapterRegistry(adapters),
    robots,
    officeUrl: "http://office.test",
    logger: createLogger({ level: "silent" }),
    pollIntervalMs: 50,
    ...extra,
  });
  return { manager, robots };
}

export const spawnInput = (
  floorId: string,
  repoId: string,
  extra: Record<string, unknown> = {},
) => ({
  floorId,
  repoId,
  provider: "custom" as const,
  model: "fake-1",
  prompt: "hello robot",
  autoWorktree: false,
  ...extra,
});
