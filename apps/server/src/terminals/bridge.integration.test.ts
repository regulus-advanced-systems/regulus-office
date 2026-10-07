/**
 * Terminal bridge end to end: real auth cookies, the fake agent running in
 * tmux on a private socket (LocalTmuxRunner), one Bun PTY `tmux attach` per
 * viewer. Covers the D12 ACL matrix on the wire, Origin/auth rejection,
 * read-only watchers, scrollback on join, resize, several viewers at once and
 * coexistence with Colyseus behind the same WsRouter. Skipped without tmux.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@colyseus/sdk";
import { FakeAdapter, Secret } from "@regulus/agent-adapters";
import { ROOM_NAMES, TERMINAL_CLOSE_CODES, type TerminalMode } from "@regulus/protocol";
import { hasTmux, LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import { bindRunnerOps, type TmuxSessionRef } from "../runners/types.ts";
import { hasBunPty } from "./pipe.ts";
import { startTerminalOffice, type TermClient, type TerminalOffice } from "./test-helpers.ts";

const FAKE_AGENT = join(import.meta.dir, "../runners/testing/fake-agent.sh");

type User = { id: string; cookie: string };

async function waitUntil(check: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

describe.skipIf(!hasTmux() || !hasBunPty())("terminal bridge (tmux + Bun PTY)", () => {
  let runner: LocalTmuxRunner;
  let office: TerminalOffice;
  let workdir: string;
  let owner: User;
  let admin: User;
  let henchmanOwner: User;
  let member: User;
  let viewer: User;
  let outsider: User;
  const open: TermClient[] = [];

  const tmux = async (...args: string[]) =>
    (await Bun.$`tmux -S ${runner.socket} ${args}`.quiet().nothrow()).stdout.toString().trim();
  const windowSize = (agentId: string) =>
    tmux("display-message", "-p", "-t", `=agent-${agentId}:`, "#{window_width}x#{window_height}");

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

  beforeAll(async () => {
    runner = await LocalTmuxRunner.create();
    workdir = await mkdtemp(join(tmpdir(), "rgo-term-"));
    office = await startTerminalOffice({ runner });
    owner = await office.signUp("Owner"); // first account: office owner
    admin = await office.signUp("Admin", "admin");
    henchmanOwner = await office.signUp("Rita");
    member = await office.signUp("Mo");
    viewer = await office.signUp("Vi", "viewer");
    outsider = await office.signUp("Out");
    office.addOperation("f1", {
      [henchmanOwner.id]: "spawn",
      [member.id]: "view",
      [viewer.id]: "view",
    });
    office.addOperation("f2");
    office.addAgent("a1", "f1", henchmanOwner.id);
    office.addAgent("a2", "f2", owner.id);
    office.addAgent("gone", "f1", henchmanOwner.id);
    const s1 = await spawnAgent("a1", henchmanOwner.id);
    // Scrollback from before anyone watched (send-keys works while no read-only client is attached).
    await runner.sendKeys(s1, "before-anyone-watched", { enter: true });
    await spawnAgent("a2", owner.id);
  });

  afterAll(async () => {
    for (const c of open) c.ws.close();
    await office?.stop();
    await runner?.dispose();
    await rm(workdir, { recursive: true, force: true });
  });

  test("screen feed: the laptop picture follows the real pane, typing is announced", async () => {
    const feed = await office.subscribeScreens("f1", member.cookie);
    await feed.waitFor(
      (f) => f.screens("a1").some((t) => t.includes("before-anyone-watched")),
      "a1 screen",
    );
    expect(feed.messages.some((m) => m.agentId === "a2")).toBe(false);
    const watcher = await connect("a1", "watch", member);
    const driver = await connect("a1", "control", henchmanOwner);
    await driver.waitFor((c) => c.output.includes("FAKE AGENT"), "driver attached");
    driver.type("shown-on-laptop\r");
    await watcher.waitFor((c) => c.controls.some((m) => m.type === "typing"), "typing notice");
    expect(watcher.controls.find((m) => m.type === "typing")).toEqual({
      type: "typing",
      userId: henchmanOwner.id,
      name: "Rita",
    });
    await feed.waitFor(
      (f) => f.screens("a1").some((t) => t.includes("you said: shown-on-laptop")),
      "screen update",
    );
    await driver.close();
    await watcher.close();
    await feed.close();
  });

  describe("ACL matrix (D12, #138: owner-only control) on the wire", () => {
    const cases: [string, () => User, TerminalMode, number][] = [
      ["office owner", () => owner, "watch", 101],
      ["office owner", () => owner, "control", 403],
      ["admin", () => admin, "watch", 101],
      ["admin", () => admin, "control", 403],
      ["henchman owner (member)", () => henchmanOwner, "watch", 101],
      ["henchman owner (member)", () => henchmanOwner, "control", 101],
      ["member", () => member, "watch", 101],
      ["member", () => member, "control", 403],
      ["viewer", () => viewer, "watch", 101],
      ["viewer", () => viewer, "control", 403],
      ["member without operation access", () => outsider, "watch", 404],
      ["member without operation access", () => outsider, "control", 404],
    ];
    for (const [who, user, mode, expected] of cases) {
      test(`${who} ${mode} → ${expected === 101 ? "attached" : expected}`, async () => {
        if (expected === 101) {
          const client = await connect("a1", mode, user());
          await client.waitFor((c) => c.hello !== undefined, "hello");
          expect(client.hello?.mode).toBe(mode);
          await client.close();
        } else {
          const res = await office.probe("a1", mode, { cookie: user().cookie });
          expect(res.status).toBe(expected);
        }
      });
    }

    test("an operation the user cannot see hides the henchman", async () => {
      expect((await office.probe("a2", "watch", { cookie: member.cookie })).status).toBe(404);
    });
  });

  test("rejects foreign origins, missing sessions, bad modes, unknown henchmen, plain GETs", async () => {
    const evil = { cookie: owner.cookie, origin: "https://evil.example" };
    expect((await office.probe("a1", "watch", evil)).status).toBe(403);
    expect((await office.probe("a1", "watch")).status).toBe(401);
    expect((await office.probe("a1", "admin", { cookie: owner.cookie })).status).toBe(400);
    expect((await office.probe("nope", "watch", { cookie: owner.cookie })).status).toBe(404);
    expect((await office.probe("..%2Fx", "watch", { cookie: owner.cookie })).status).toBe(404);
    expect((await office.probe("gone", "watch", { cookie: owner.cookie })).status).toBe(404);
    const plain = await fetch(new URL("/ws/term/a1?mode=watch", office.server.url));
    expect(plain.status).toBe(426);
  });

  test("hello, then scrollback, then live bytes", async () => {
    const client = await connect("a1", "watch", member);
    await client.waitFor((c) => c.output.includes("before-anyone-watched"), "scrollback");
    expect(client.hello).toEqual({
      type: "hello",
      mode: "watch",
      cols: 160,
      rows: 45,
      viewers: 1,
      peers: [{ userId: member.id, name: "Mo", mode: "watch" }],
    });
    const second = client.frames[1];
    expect(second && "bytes" in second).toBe(true);
    const scrollback = new TextDecoder().decode((second as { bytes: Uint8Array }).bytes);
    expect(scrollback).toContain("you said: before-anyone-watched\r\n");
    await client.close();
  });

  test("control types into the agent; watchers see it but cannot type or resize", async () => {
    // Who opened the terminal and who typed in it (the agent manager's listener, #235).
    const viewed: string[] = [];
    office.bridge.onViewed((agentId, userId) => viewed.push(`${agentId}:${userId}`));
    const watcher = await connect("a1", "watch", member);
    expect(viewed).toEqual([`a1:${member.id}`]);
    const driver = await connect("a1", "control", henchmanOwner);
    expect(viewed).toEqual([`a1:${member.id}`, `a1:${henchmanOwner.id}`]);
    await driver.waitFor((c) => c.output.includes("FAKE AGENT"), "control attach");
    await watcher.waitFor((c) => c.output.includes("FAKE AGENT"), "watch attach");

    watcher.type("typed-by-watcher\r");
    watcher.resize(80, 20);
    driver.type("typed-by-owner\r");
    await watcher.waitFor((c) => c.output.includes("you said: typed-by-owner"), "echo in watch");
    await driver.waitFor((c) => c.output.includes("you said: typed-by-owner"), "echo in control");
    await Bun.sleep(100);
    const pane = await runner.capturePane({ userId: henchmanOwner.id, name: "agent-a1" }, 200);
    expect(pane).not.toContain("typed-by-watcher");
    // The owner's typing counts once more (throttled); a watcher's dropped keys never do.
    expect(viewed.slice(2)).toEqual([`a1:${henchmanOwner.id}`]);
    office.bridge.onViewed(() => {});
    // The control client (160x45 minus tmux's status line) sets the size, never the watcher.
    expect(await windowSize("a1")).toBe("160x44");

    driver.resize(100, 30);
    const deadline = Date.now() + 3000;
    while ((await windowSize("a1")) !== "100x29" && Date.now() < deadline) await Bun.sleep(20);
    expect(await windowSize("a1")).toBe("100x29");
    driver.resize(160, 45);
    await watcher.close();
    await driver.close();
  });

  test("five concurrent viewers on one session: counts, fan-out latency, clean teardown", async () => {
    await waitUntil(() => office.bridge.viewerCount("a1") === 0, "earlier viewers gone");
    const driver = await connect("a1", "control", henchmanOwner);
    const viewers: TermClient[] = [];
    for (let i = 0; i < 5; i += 1) viewers.push(await connect("a1", "watch", member));
    for (const v of viewers) await v.waitFor((c) => c.output.includes("FAKE AGENT"), "attach");
    expect(viewers.map((v) => v.hello?.viewers)).toEqual([2, 3, 4, 5, 6]);
    await driver.waitFor(
      (c) => c.controls.some((m) => m.type === "viewers" && m.viewers === 6),
      "viewer count",
    );
    expect(office.bridge.viewerCount("a1")).toBe(6);

    const rounds = 30;
    const latencies: number[] = [];
    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    for (let i = 0; i < rounds; i += 1) {
      const marker = `m${i}x${Date.now()}`;
      const t0 = performance.now();
      driver.type(`${marker}\r`);
      for (const v of viewers) {
        await v.waitFor((c) => c.output.includes(`you said: ${marker}`), `marker ${i}`);
        latencies.push(performance.now() - t0);
      }
    }
    const wall = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    latencies.sort((a, b) => a - b);
    const pct = (p: number) =>
      latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
    const cpuPct = ((cpu.user + cpu.system) / 1000 / wall) * 100;
    console.log(
      `[load] 5 watchers + 1 driver, ${rounds} rounds: keystroke→all-viewers p50=${pct(0.5).toFixed(1)}ms ` +
        `p95=${pct(0.95).toFixed(1)}ms max=${pct(1).toFixed(1)}ms; office process CPU ${cpuPct.toFixed(1)}% over ${wall.toFixed(0)}ms`,
    );
    expect(pct(0.95)).toBeLessThan(1000);

    await viewers[0]?.close();
    await driver.waitFor(
      (c) => c.controls.some((m) => m.type === "viewers" && m.viewers === 5),
      "count after leave",
    );
    for (const v of viewers.slice(1)) await v.close();
    await driver.close();
    const deadline = Date.now() + 3000;
    while ((await tmux("list-clients", "-t", "=agent-a1")) !== "" && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(await tmux("list-clients", "-t", "=agent-a1")).toBe("");
    expect(office.bridge.viewerCount("a1")).toBe(0);
    expect(await runner.sessionExists({ userId: henchmanOwner.id, name: "agent-a1" })).toBe(true);
  });

  test("Colyseus rooms still work behind the same WsRouter", async () => {
    const url = String(office.server.url).replace(/\/$/, "");
    const room = await new Client(url, { headers: { cookie: owner.cookie } }).joinOrCreate(
      ROOM_NAMES.building,
    );
    expect(room.roomId).toBeTruthy();
    await room.leave();
  });

  test("viewers are closed with sessionEnded when the agent's session ends", async () => {
    const client = await connect("a2", "watch", owner);
    await client.waitFor((c) => c.output.includes("FAKE AGENT"), "attach");
    await runner.kill({ userId: owner.id, agentId: "a2" });
    expect(await client.closed).toBe(TERMINAL_CLOSE_CODES.sessionEnded);
  });
});
