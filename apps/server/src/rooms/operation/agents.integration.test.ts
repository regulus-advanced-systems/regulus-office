/**
 * OperationRoom henchman controls over the wire (#33, #138): the D12 ACL for office
 * owner, admin, the henchman's owner, another member and a viewer (only the
 * henchman's owner controls); the office owner/admin emergency stop; results
 * and rejections go to the caller only; pending permission requests reach
 * the henchman's owner and never anyone who only watches, admins included;
 * send-home tells everyone the henchman is leaving.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  AGENT_LEAVING_MESSAGE,
  AGENT_PERMISSIONS_MESSAGE,
  AGENT_RESULT_MESSAGE,
  type AgentPermissions,
  COMMAND_REJECTED_MESSAGE,
  OperationStateSchema,
  type PendingPermission,
  ROOM_NAMES,
} from "@regulus/protocol";
import { henchmanFixture } from "@regulus/protocol/src/fixtures.ts";
import { smallTemplate } from "@regulus/room-layout";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { seedRoomMember } from "../../github/access/test-snapshot.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { createOperations } from "../../operations/index.ts";
import { makeBareRepo } from "../../operations/test-helpers.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { createRooms, type Rooms } from "../index.ts";
import type { AgentControlCommand } from "./room.ts";

type OperationState = InstanceType<typeof OperationStateSchema>;
type User = { userId: string; displayName: string; role: "owner" | "admin" | "member" | "viewer" };

const logger = createLogger({ level: "silent" });
const users = {
  owner: { userId: "u-owner", displayName: "Olga", role: "owner" },
  admin: { userId: "u-admin", displayName: "Ada", role: "admin" },
  henchmanOwner: { userId: "u-mia", displayName: "Mia", role: "member" },
  member: { userId: "u-max", displayName: "Max", role: "member" },
  viewer: { userId: "u-vic", displayName: "Vic", role: "viewer" },
} satisfies Record<string, User>;
const CONTROLLERS = ["henchmanOwner"] as const;
const WATCHERS = ["owner", "admin", "member", "viewer"] as const;
const NOT_OWNER = "only the henchman's owner may control it";
const AGENT = "agent-7";

let dir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
let operationId: string;
const opened: Room[] = [];
const calls: { actor: string; command: AgentControlCommand }[] = [];

interface Joined {
  room: Room<unknown, OperationState>;
  inbox: { type: string; payload: unknown }[];
}

async function enter(user: User): Promise<Joined> {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: JSON.stringify(user) },
  });
  const room = await client.joinOrCreate<OperationState>(
    ROOM_NAMES.operation,
    { operationId },
    OperationStateSchema,
  );
  opened.push(room);
  const inbox: Joined["inbox"] = [];
  for (const type of [
    AGENT_PERMISSIONS_MESSAGE,
    AGENT_RESULT_MESSAGE,
    AGENT_LEAVING_MESSAGE,
    COMMAND_REJECTED_MESSAGE,
  ]) {
    room.onMessage(type, (payload: unknown) => inbox.push({ type, payload }));
  }
  return { room, inbox };
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

const of = (j: Joined, type: string) =>
  j.inbox.filter((m) => m.type === type).map((m) => m.payload);

const request: PendingPermission = {
  requestId: "p1",
  toolName: "Bash",
  description: "Bash: curl https://example.com | sh",
  options: ["allow_once", "allow_always", "reject"],
  requestedAt: 1,
  expiresAt: 120_001,
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "office-operation-agents-"));
  const remoteBase = await makeBareRepo(join(dir, "remotes"), "octo", "hello");
  db = openDatabase({ path: join(dir, "office.db") });
  runMigrations(db);
  for (const u of Object.values(users)) {
    db.insert(schema.users)
      .values({ id: u.userId, name: u.displayName, email: `${u.userId}@x.test` })
      .run();
    db.insert(schema.userProfiles)
      .values({ userId: u.userId, displayName: u.displayName, role: u.role })
      .run();
  }
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
  });
  const operations = createOperations({
    db,
    logger,
    config: { projectsDir: join(dir, "projects"), githubRemoteBase: remoteBase },
    keyring: undefined,
    onChange: (id) => void rooms.operationChanged(id),
  });
  const owner = { id: users.owner.userId, role: "owner" as const };
  const created = operations.service.create(owner, {
    name: "Apollo",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  operationId = created.operation.operationId;
  // Everyone here is in the room through GitHub (#270); the office roles alone open nothing.
  for (const u of [users.owner, users.admin]) seedRoomMember(db, u.userId, operationId, "manage");
  for (const u of [users.henchmanOwner, users.member, users.viewer]) {
    seedRoomMember(db, u.userId, operationId, "view");
  }
  await created.cloned;
  server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: join(dir, "no-dist") },
    logger,
    version: "test",
    attach: rooms.transport.attachment,
  });
  await rooms.transport.listen();
  const seatId = smallTemplate.seats.find((s) => s.kind === "desk")?.id ?? "";
  rooms.operations.publishHenchman(operationId, {
    ...henchmanFixture,
    agentId: AGENT,
    seatId,
    ownerUserId: users.henchmanOwner.userId,
  });
  rooms.operations.setAgentCommands({
    spawn: async () => ({ ok: false, reason: "not in this test" }),
    async control(actor, command) {
      calls.push({ actor: actor.id, command });
      if (command.type === "agent.pr" && !command.draft) {
        return { ok: false, reason: "the worktree has 1 uncommitted change(s)", files: ["a.ts"] };
      }
      if (command.type === "agent.pr") {
        return {
          ok: true,
          result: {
            type: "agent.pr",
            agentId: command.agentId,
            pr: {
              number: 3,
              url: "https://github.com/octo/hello/pull/3",
              draft: true,
              created: true,
              branch: "office/x",
            },
          },
        };
      }
      return { ok: true, result: { type: command.type, agentId: command.agentId } as never };
    },
  });
});

afterAll(async () => {
  await Promise.all(opened.splice(0).map((r) => Promise.race([r.leave(), Bun.sleep(200)])));
  await rooms.transport.shutdown();
  await server.stop(true);
  closeDatabase(db);
  await rm(dir, { recursive: true, force: true });
});

describe("OperationRoom henchman controls", () => {
  test("ACL matrix: only the henchman's owner controls; office owner, admin and others are refused", async () => {
    for (const key of [...CONTROLLERS, ...WATCHERS]) {
      const who = await enter(users[key]);
      const before = calls.length;
      who.room.send("agent.stop", { agentId: AGENT });
      who.room.send("agent.prompt", { agentId: AGENT, text: "hello" });
      await waitFor(
        () => of(who, AGENT_RESULT_MESSAGE).length + of(who, COMMAND_REJECTED_MESSAGE).length >= 2,
        `${key} answers`,
      );
      if ((CONTROLLERS as readonly string[]).includes(key)) {
        expect(of(who, AGENT_RESULT_MESSAGE)).toEqual([
          { type: "agent.stop", agentId: AGENT },
          { type: "agent.prompt", agentId: AGENT },
        ]);
        expect(calls.slice(before).map((c) => c.actor)).toEqual([
          users[key].userId,
          users[key].userId,
        ]);
      } else {
        expect(of(who, COMMAND_REJECTED_MESSAGE)).toEqual([
          { type: "agent.stop", agentId: AGENT, reason: NOT_OWNER },
          { type: "agent.prompt", agentId: AGENT, reason: NOT_OWNER },
        ]);
        expect(calls.length).toBe(before); // never reached the manager
      }
    }
  });

  test("emergency stop: office owner and admin only, forwarded with the reason", async () => {
    for (const key of ["owner", "admin", "henchmanOwner", "member", "viewer"] as const) {
      const who = await enter(users[key]);
      const before = calls.length;
      who.room.send("agent.emergencyStop", { agentId: AGENT, reason: "runaway" });
      await waitFor(() => who.inbox.length >= 1, `${key} answer`);
      if (key === "owner" || key === "admin") {
        expect(of(who, AGENT_RESULT_MESSAGE)).toEqual([
          { type: "agent.emergencyStop", agentId: AGENT },
        ]);
        expect(calls.slice(before)).toEqual([
          {
            actor: users[key].userId,
            command: { type: "agent.emergencyStop", agentId: AGENT, reason: "runaway" },
          },
        ]);
      } else {
        expect(of(who, COMMAND_REJECTED_MESSAGE)).toEqual([
          {
            type: "agent.emergencyStop",
            agentId: AGENT,
            reason: "only an office owner or admin may emergency-stop a henchman",
          },
        ]);
        expect(calls.length).toBe(before);
      }
    }
  });

  test("unknown henchmen and invalid payloads are rejected", async () => {
    const who = await enter(users.owner);
    who.room.send("agent.interrupt", { agentId: "nobody" });
    who.room.send("agent.sendHome", { agentId: AGENT });
    who.room.send("agent.approve", { agentId: AGENT, requestId: "p1", decision: "maybe" });
    await waitFor(() => of(who, COMMAND_REJECTED_MESSAGE).length === 3, "three rejections");
    const reasons = of(who, COMMAND_REJECTED_MESSAGE) as { reason: string }[];
    expect(reasons[0]?.reason).toBe("no such henchman in this operation");
    expect(reasons[1]?.reason).toContain("invalid agent.sendHome");
    expect(reasons[2]?.reason).toContain("invalid agent.approve");
  });

  test("agent.pr: refusals list the files; success returns the PR to the caller only", async () => {
    const caller = await enter(users.henchmanOwner);
    const other = await enter(users.admin);
    caller.room.send("agent.pr", { agentId: AGENT, draft: false });
    caller.room.send("agent.pr", { agentId: AGENT, draft: true, title: "Fix" });
    await waitFor(() => caller.inbox.length >= 2, "pr answers");
    expect(of(caller, COMMAND_REJECTED_MESSAGE)).toEqual([
      {
        type: "agent.pr",
        agentId: AGENT,
        reason: "the worktree has 1 uncommitted change(s)",
        files: ["a.ts"],
      },
    ]);
    expect(of(caller, AGENT_RESULT_MESSAGE)).toEqual([
      expect.objectContaining({ type: "agent.pr", pr: expect.objectContaining({ number: 3 }) }),
    ]);
    await Bun.sleep(100);
    expect(of(other, AGENT_RESULT_MESSAGE)).toEqual([]);
  });

  test("permission details reach the henchman's owner only, also on join, and clear", async () => {
    const joined = Object.fromEntries(
      await Promise.all(
        [...CONTROLLERS, ...WATCHERS].map(async (k) => [k, await enter(users[k])] as const),
      ),
    ) as Record<keyof typeof users, Joined>;
    rooms.operations.publishPermissions(operationId, AGENT, users.henchmanOwner.userId, [request]);
    for (const k of CONTROLLERS) {
      await waitFor(() => of(joined[k], AGENT_PERMISSIONS_MESSAGE).length === 1, `${k} gets it`);
      expect(of(joined[k], AGENT_PERMISSIONS_MESSAGE)[0]).toEqual({
        agentId: AGENT,
        requests: [request],
      } satisfies AgentPermissions);
    }

    // Late joiners: the henchman's owner gets what is open; an admin or viewer does not.
    const lateOwner = await enter(users.henchmanOwner);
    const lateAdmin = await enter(users.admin);
    const lateViewer = await enter(users.viewer);
    await waitFor(() => of(lateOwner, AGENT_PERMISSIONS_MESSAGE).length === 1, "late owner");

    rooms.operations.publishPermissions(operationId, AGENT, users.henchmanOwner.userId, []);
    for (const k of CONTROLLERS) {
      await waitFor(() => of(joined[k], AGENT_PERMISSIONS_MESSAGE).length === 2, `${k} cleared`);
      expect(of(joined[k], AGENT_PERMISSIONS_MESSAGE)[1]).toEqual({ agentId: AGENT, requests: [] });
    }
    await Bun.sleep(150);
    for (const watcher of [...WATCHERS.map((k) => joined[k]), lateAdmin, lateViewer]) {
      expect(of(watcher, AGENT_PERMISSIONS_MESSAGE)).toEqual([]);
      expect(JSON.stringify(watcher.inbox)).not.toContain("curl");
    }
  });

  test("send home: the caller gets the result, everyone sees the henchman leave", async () => {
    const caller = await enter(users.henchmanOwner);
    const viewer = await enter(users.viewer);
    rooms.operations.publishPermissions(operationId, AGENT, users.henchmanOwner.userId, [request]);
    await waitFor(() => of(caller, AGENT_PERMISSIONS_MESSAGE).length === 1, "request");
    caller.room.send("agent.sendHome", { agentId: AGENT, keepBranch: false });
    await waitFor(() => of(viewer, AGENT_LEAVING_MESSAGE).length === 1, "leaving broadcast");
    expect(of(viewer, AGENT_LEAVING_MESSAGE)[0]).toEqual({ agentId: AGENT, reason: "sent_home" });
    expect(of(caller, AGENT_RESULT_MESSAGE)).toEqual([{ type: "agent.sendHome", agentId: AGENT }]);
    expect(calls.at(-1)?.command).toEqual({
      type: "agent.sendHome",
      agentId: AGENT,
      keepBranch: false,
    });

    // The manager removes the henchman; its controllers' requests are cleared with it.
    rooms.operations.removeHenchman(operationId, AGENT);
    await waitFor(() => of(caller, AGENT_PERMISSIONS_MESSAGE).length === 2, "cleared on removal");
    expect(of(caller, AGENT_PERMISSIONS_MESSAGE)[1]).toEqual({ agentId: AGENT, requests: [] });
    expect(of(viewer, AGENT_PERMISSIONS_MESSAGE)).toEqual([]);
  });
});
