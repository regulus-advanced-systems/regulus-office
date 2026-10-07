/**
 * Lost access closes open terminals, laptop screen feeds and room seats
 * (#244), end to end with real session cookies: the fake agent runs in tmux,
 * two humans are connected, and access is withdrawn from one of them through
 * each of today's causes (removed from the operation, role changed, operation
 * archived, signed out). Each connection closes promptly with an
 * `ACCESS_CLOSE_CODES` code and nothing more reaches it; the other human is
 * not disturbed. Skipped without tmux.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import { FakeAdapter, Secret } from "@regulus/agent-adapters";
import {
  ACCESS_CLOSE_CODES,
  BuildingStateSchema,
  OperationStateSchema,
  ROOM_NAMES,
  type TerminalMode,
} from "@regulus/protocol";
import { henchmanFixture } from "@regulus/protocol/src/fixtures.ts";
import { and, eq } from "drizzle-orm";
import { operationMembers, operations } from "../db/schema/index.ts";
import { hasTmux, LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import { bindRunnerOps, type TmuxSessionRef } from "../runners/types.ts";
import { hasBunPty } from "./pipe.ts";
import { startTerminalOffice, type TermClient, type TerminalOffice } from "./test-helpers.ts";

const FAKE_AGENT = join(import.meta.dir, "../runners/testing/fake-agent.sh");
/** "Promptly": well under the second the issue asks for. */
const PROMPT_MS = 1000;

type User = { id: string; cookie: string };

async function waitUntil(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

describe.skipIf(!hasTmux() || !hasBunPty())("live access: terminals, screens and rooms", () => {
  let runner: LocalTmuxRunner;
  let office: TerminalOffice;
  let workdir: string;
  let admin: User;
  let rita: User;
  const open: TermClient[] = [];
  /** Leaves each room the server did not already close. */
  const stillOpen: Array<() => Promise<void> | undefined> = [];
  let seq = 0;

  async function spawnAgent(agentId: string, ownerId: string): Promise<TmuxSessionRef> {
    const user = { userId: ownerId };
    const handle = await runner.provision(user);
    const plan = new FakeAdapter({ command: ["sh", FAKE_AGENT] }).buildSpawn(
      {
        agentId,
        provider: "custom",
        workdir,
        credential: { kind: "api_key", apiKey: Secret.of("k"), attributedTo: "user" },
      },
      {
        backend: runner.backend,
        userId: ownerId,
        home: handle.home,
        officeUrl: "http://office.test",
        agentToken: Secret.of("t"),
        now: Date.now,
        runner: bindRunnerOps(runner, user),
      },
    );
    const session = await runner.exec(user, plan);
    const deadline = Date.now() + 5000;
    while (!(await runner.capturePane(session, 50)).includes("READY") && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    return session;
  }

  const connect = async (agentId: string, mode: TerminalMode, user: User) => {
    const client = await office.connect(agentId, mode, user.cookie);
    open.push(client);
    return client;
  };

  /** A fresh operation with Rita's henchman on it and one more member. */
  const scene = async (access: "spawn" | "view" = "view") => {
    seq += 1;
    const operationId = `f${seq}`;
    const agentId = `a${seq}`;
    const member = await office.signUp(`Mo${seq}`);
    office.addOperation(operationId, { [rita.id]: "spawn", [member.id]: access });
    office.addAgent(agentId, operationId, rita.id);
    const session = await spawnAgent(agentId, rita.id);
    return { operationId, agentId, member, session };
  };

  const removeMember = (operationId: string, user: User) => {
    office.db
      .delete(operationMembers)
      .where(
        and(eq(operationMembers.operationId, operationId), eq(operationMembers.userId, user.id)),
      )
      .run();
    return office.liveAccess.accessChanged({ userId: user.id, operationIds: [operationId] });
  };

  const colyseus = (user: User) =>
    new Client(String(office.server.url).replace(/\/$/, ""), {
      headers: { cookie: user.cookie },
    });

  /** Join a room and record how it ended. */
  const enter = async <S>(user: User, name: string, options: object, schema: unknown) => {
    const room = (await colyseus(user).joinOrCreate(name, options, schema as never)) as Room<
      unknown,
      S
    >;
    const left: { code: number; at: number }[] = [];
    room.onLeave((code) => left.push({ code, at: Date.now() }));
    // Quiet by default; a test that counts messages adds its own listener.
    room.onMessage("*", () => {});
    stillOpen.push(() => (left.length === 0 ? room.leave().then(() => undefined) : undefined));
    return { room, left };
  };
  const joinOperation = (user: User, operationId: string) =>
    enter<InstanceType<typeof OperationStateSchema>>(
      user,
      ROOM_NAMES.operation,
      { operationId },
      OperationStateSchema,
    );
  const joinBuilding = (user: User) =>
    enter<InstanceType<typeof BuildingStateSchema>>(
      user,
      ROOM_NAMES.building,
      {},
      BuildingStateSchema,
    );

  const setRole = async (user: User, role: string) => {
    const res = await fetch(new URL(`/api/users/${user.id}/role`, office.server.url), {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: office.origin, cookie: admin.cookie },
      body: JSON.stringify({ role }),
    });
    expect(res.status).toBe(200);
  };

  beforeAll(async () => {
    runner = await LocalTmuxRunner.create();
    workdir = await mkdtemp(join(tmpdir(), "rgo-live-"));
    office = await startTerminalOffice({ runner, screens: { intervalMs: 30 } });
    admin = await office.signUp("Olga"); // first account: office owner
    rita = await office.signUp("Rita");
  });

  afterAll(async () => {
    for (const c of open) c.ws.close();
    await Promise.all(stillOpen.map((leave) => leave()?.catch(() => undefined)));
    await office?.stop();
    await runner?.dispose();
    await rm(workdir, { recursive: true, force: true });
  });

  test("terminal: a watcher removed from the operation is closed; output stops for them only", async () => {
    const { operationId, agentId, member } = await scene();
    const driver = await connect(agentId, "control", rita);
    const watcher = await connect(agentId, "watch", member);
    await driver.waitFor((c) => c.output.includes("FAKE AGENT"), "driver attached");
    await watcher.waitFor((c) => c.output.includes("FAKE AGENT"), "watcher attached");
    driver.type("before-removal\r");
    await watcher.waitFor((c) => c.output.includes("you said: before-removal"), "shared output");

    const at = Date.now();
    expect(removeMember(operationId, member)).toEqual({ checked: 1, ended: 1 });
    expect(await watcher.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(Date.now() - at).toBeLessThan(PROMPT_MS);

    const frames = watcher.frames.length;
    driver.type("after-removal\r");
    await driver.waitFor((c) => c.output.includes("you said: after-removal"), "the owner's output");
    await Bun.sleep(150);
    expect(watcher.frames.length).toBe(frames);
    expect(watcher.output).not.toContain("after-removal");
    expect(driver.closeCode).toBeUndefined();
    // The owner is told the watcher left, and a new attempt is refused before any socket.
    await driver.waitFor(
      (c) => c.controls.some((m) => m.type === "viewers" && m.viewers === 1),
      "viewer count",
    );
    expect((await office.probe(agentId, "watch", { cookie: member.cookie })).status).toBe(404);
  });

  test("terminal: the controller demoted to viewer is closed with `changed`; typing stops", async () => {
    const { agentId, member } = await scene();
    const driver = await connect(agentId, "control", rita);
    const watcher = await connect(agentId, "watch", member);
    await driver.waitFor((c) => c.output.includes("FAKE AGENT"), "driver attached");
    await watcher.waitFor((c) => c.output.includes("FAKE AGENT"), "watcher attached");

    await setRole(rita, "viewer");
    expect(await driver.closed).toBe(ACCESS_CLOSE_CODES.changed);
    driver.type("typed-after-demotion\r");
    await Bun.sleep(200);
    expect(watcher.output).not.toContain("typed-after-demotion");
    expect(watcher.closeCode).toBeUndefined();
    // Control is refused now; watching still works, as the client falls back to.
    expect((await office.probe(agentId, "control", { cookie: rita.cookie })).status).toBe(403);
    const again = await connect(agentId, "watch", rita);
    expect(again.hello?.mode).toBe("watch");
    await setRole(rita, "member");
  });

  test("terminal and screens: an archived operation closes both for everyone", async () => {
    const { operationId, agentId, member } = await scene();
    const driver = await connect(agentId, "control", rita);
    const watcher = await connect(agentId, "watch", member);
    const feed = await office.subscribeScreens(operationId, member.cookie);
    await feed.waitFor((f) => f.screens(agentId).length > 0, "a screen");

    office.db
      .update(operations)
      .set({ archivedAt: new Date() })
      .where(eq(operations.id, operationId))
      .run();
    expect(office.liveAccess.accessChanged({ operationIds: [operationId] })).toEqual({
      checked: 3,
      ended: 3,
    });
    expect(await driver.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(await watcher.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(await feed.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(office.bridge.viewerCount(agentId)).toBe(0);
    expect(office.screens.poller(operationId)).toBeUndefined();
  });

  test("screens: a removed subscriber gets no further screens; the other one does", async () => {
    const { operationId, agentId, member, session } = await scene();
    const mine = await office.subscribeScreens(operationId, rita.cookie);
    const theirs = await office.subscribeScreens(operationId, member.cookie);
    await mine.waitFor((f) => f.screens(agentId).length > 0, "owner's screen");
    await theirs.waitFor((f) => f.screens(agentId).length > 0, "member's screen");

    const at = Date.now();
    removeMember(operationId, member);
    expect(await theirs.closed).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(Date.now() - at).toBeLessThan(PROMPT_MS);
    const seen = theirs.messages.length;
    await runner.sendKeys(session, "after-removal", { enter: true });
    await mine.waitFor(
      (f) => f.screens(agentId).some((t) => t.includes("you said: after-removal")),
      "the owner's screen update",
    );
    expect(theirs.messages.length).toBe(seen);
    await mine.close();
  });

  test("operation room: a removed member's seat closes; state stops for them only", async () => {
    const { operationId, member } = await scene();
    const stays = await joinOperation(rita, operationId);
    const goes = await joinOperation(member, operationId);
    office.rooms.operations.publishHenchman(operationId, {
      ...henchmanFixture,
      agentId: "h-before",
    });
    await waitUntil(() => goes.room.state.henchmen.has("h-before"), "state before removal");

    const at = Date.now();
    expect(removeMember(operationId, member)).toEqual({ checked: 1, ended: 1 });
    await waitUntil(() => goes.left.length > 0, "the seat closing");
    expect(goes.left[0]?.code).toBe(ACCESS_CLOSE_CODES.revoked);
    expect((goes.left[0]?.at ?? 0) - at).toBeLessThan(PROMPT_MS);

    let lateMessages = 0;
    goes.room.onMessage("*", () => {
      lateMessages += 1;
    });
    office.rooms.operations.publishHenchman(operationId, {
      ...henchmanFixture,
      agentId: "h-after",
    });
    office.rooms.operations.broadcast(operationId, "gong.ring", { rings: 1 });
    await waitUntil(() => stays.room.state.henchmen.has("h-after"), "state for the one who stays");
    await Bun.sleep(150);
    expect(goes.room.state.henchmen.has("h-after")).toBe(false);
    expect(lateMessages).toBe(0);
    expect(stays.left).toHaveLength(0);
    // Asking again is refused at the door, so a client cannot loop its way back in.
    await expect(joinOperation(member, operationId)).rejects.toMatchObject({ code: 403 });
  });

  test("rooms: a role change closes the human's seats with `changed`; they come back with the new role", async () => {
    const { operationId, member } = await scene("spawn");
    const lobby = await joinBuilding(member);
    const seat = await joinOperation(member, operationId);
    const other = await joinBuilding(rita);
    await waitUntil(
      () => [...other.room.state.humans.values()].some((h) => h.userId === member.id),
      "presence",
    );

    await setRole(member, "viewer");
    await waitUntil(() => lobby.left.length > 0 && seat.left.length > 0, "both seats closing");
    expect(lobby.left[0]?.code).toBe(ACCESS_CLOSE_CODES.changed);
    expect(seat.left[0]?.code).toBe(ACCESS_CLOSE_CODES.changed);
    expect(other.left).toHaveLength(0);

    const back = await joinBuilding(member);
    await waitUntil(() => back.room.state.humans.has(back.room.sessionId), "the new seat");
    expect(back.room.state.humans.get(back.room.sessionId)?.role).toBe("viewer");
    expect((await joinOperation(member, operationId)).room.roomId).toBeTruthy();
  });

  test("signed out: every connection of that session closes with `signedOut`", async () => {
    const { operationId, agentId, member } = await scene();
    const lobby = await joinBuilding(member);
    const seat = await joinOperation(member, operationId);
    const term = await connect(agentId, "watch", member);
    const feed = await office.subscribeScreens(operationId, member.cookie);
    const ritaLobby = await joinBuilding(rita);
    const ritaTerm = await connect(agentId, "control", rita);
    await ritaTerm.waitFor((c) => c.output.includes("FAKE AGENT"), "owner attached");

    const at = Date.now();
    const res = await fetch(new URL("/api/auth/sign-out", office.server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: office.origin, cookie: member.cookie },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await term.closed).toBe(ACCESS_CLOSE_CODES.signedOut);
    expect(await feed.closed).toBe(ACCESS_CLOSE_CODES.signedOut);
    await waitUntil(() => lobby.left.length > 0 && seat.left.length > 0, "both seats closing");
    expect(lobby.left[0]?.code).toBe(ACCESS_CLOSE_CODES.signedOut);
    expect(seat.left[0]?.code).toBe(ACCESS_CLOSE_CODES.signedOut);
    expect(Date.now() - at).toBeLessThan(PROMPT_MS);

    // Their avatar is gone from the lobby; nobody else was touched.
    await waitUntil(
      () => ![...ritaLobby.room.state.humans.values()].some((h) => h.userId === member.id),
      "presence removed",
    );
    expect(ritaLobby.left).toHaveLength(0);
    expect(ritaTerm.closeCode).toBeUndefined();
    expect(office.liveAccess.count({ userId: member.id })).toBe(0);
    await expect(joinBuilding(member)).rejects.toMatchObject({ code: 401 });
  });
});
