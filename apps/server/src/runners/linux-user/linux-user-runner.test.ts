/**
 * Command construction with the helper mocked: exact sudo argv per verb, what
 * goes on stdin, and that secrets never reach an argv or an error message.
 */
import { describe, expect, test } from "bun:test";
import { FakeAdapter, Secret, type SpawnPlan } from "@regulus/agent-adapters";
import { bindRunnerOps } from "../types.ts";
import type { HelperCall, HelperResult } from "./helper-client.ts";
import { runnerId } from "./ids.ts";
import { envScript, LinuxUserRunner } from "./linux-user-runner.ts";

const HELPER = "/usr/local/lib/office/office-runner-helper";
const KEY = "sk-unit-DO-NOT-LEAK";
const TOKEN = "hook-token-DO-NOT-LEAK";
const user = { userId: "u1" };

type Reply = Partial<HelperResult> | ((call: HelperCall) => Partial<HelperResult>);

function mocked(replies: Record<string, Reply> = {}) {
  const calls: HelperCall[] = [];
  const spawned: { argv: readonly string[]; written: string[] }[] = [];
  const runner = new LinuxUserRunner({
    run: async (call) => {
      calls.push(call);
      const reply = replies[call.argv[3] ?? ""] ?? {};
      const r = typeof reply === "function" ? reply(call) : reply;
      return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    spawn: (argv) => {
      const rec = { argv, written: [] as string[] };
      spawned.push(rec);
      return {
        pid: 42,
        stdout: new Response("").body as ReadableStream<Uint8Array>,
        stderr: new Response("").body as ReadableStream<Uint8Array>,
        exited: Promise.resolve(0),
        async write(chunk) {
          rec.written.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
        },
        kill() {},
      };
    },
  });
  return { runner, calls, spawned };
}

function plan(runner: LinuxUserRunner, agentId = "a1"): SpawnPlan {
  const adapter = new FakeAdapter({ command: ["sh", "/opt/fake-agent.sh"] });
  return adapter.buildSpawn(
    {
      agentId,
      provider: "custom",
      workdir: "/srv/office/worktrees/f1/u1/_clones/r1",
      credential: { kind: "api_key", apiKey: Secret.of(KEY), attributedTo: "user" },
    },
    {
      backend: "linux-user",
      userId: user.userId,
      home: "/home/office-u-u1",
      officeUrl: "http://office.test",
      agentToken: Secret.of(TOKEN),
      now: Date.now,
      runner: bindRunnerOps(runner, user),
    },
  );
}

describe("LinuxUserRunner command construction", () => {
  test("provision parses the helper's report", async () => {
    const { runner, calls } = mocked({
      provision: {
        stdout: "uid=1001\ngid=1001\nhome=/home/office-u-u1\nsocket=/run/office/tmux/u1.sock\n",
      },
    });
    expect(await runner.provision(user)).toEqual({
      userId: "u1",
      backend: "linux-user",
      home: "/home/office-u-u1",
      tmuxSocket: "/run/office/tmux/u1.sock",
      uid: 1001,
    });
    expect(calls[0]?.argv).toEqual(["sudo", "-n", HELPER, "provision", "u1"]);
  });

  test("UUID user ids are passed as their compact runner id", async () => {
    const { runner, calls } = mocked();
    const id = "0b7e8f3c-1d2a-4c55-9f00-6e2b1a3c4d5e";
    await runner.listSessions({ userId: id });
    expect(calls[0]?.argv).toEqual(["sudo", "-n", HELPER, "list-sessions", runnerId(id)]);
  });

  test("exec writes files and env over stdin, never on argv", async () => {
    const { runner, calls } = mocked();
    const p = plan(runner);
    expect(await runner.exec(user, p)).toEqual({ userId: "u1", name: "agent-a1" });

    const [write, exec] = calls;
    expect(write?.argv).toEqual([
      "sudo",
      "-n",
      HELPER,
      "write-file",
      "u1",
      "/home/office-u-u1/.fake-agent/a1.json",
      "600",
    ]);
    expect(write?.stdin).toContain(TOKEN);
    expect(exec?.argv).toEqual([
      "sudo",
      "-n",
      HELPER,
      "exec",
      "u1",
      "a1",
      "/srv/office/worktrees/f1/u1/_clones/r1",
      "--",
      "sh",
      "/opt/fake-agent.sh",
    ]);
    expect(exec?.stdin).toBe(`${envScript(p.env.reveal())}\0`);
    expect(exec?.stdin).toContain(`export FAKE_API_KEY='${KEY}'\n`);
    for (const call of calls) {
      expect(call.argv.join(" ")).not.toContain(KEY);
      expect(call.argv.join(" ")).not.toContain(TOKEN);
    }
  });

  test("a failing exec reports helper stderr but not the env", async () => {
    const { runner } = mocked({ exec: { code: 1, stderr: "office-runner-helper: boom\n" } });
    const err = await runner.exec(user, plan(runner)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toContain("boom");
    expect(String(err)).not.toContain(KEY);
  });

  test("exec rejects a session name that is not agent-<agentId>", async () => {
    const { runner, calls } = mocked();
    const p = { ...plan(runner), tmuxSession: "agent-other" };
    await expect(runner.exec(user, p)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("spawnPiped sends the NUL-terminated env script first", async () => {
    const { runner, spawned } = mocked();
    const p = plan(runner, "a2");
    await runner.spawnPiped(user, p);
    expect(spawned[0]?.argv.slice(3, 7)).toEqual(["spawn-piped", "u1", "a2", p.cwd]);
    expect(spawned[0]?.argv.join(" ")).not.toContain(KEY);
    expect(spawned[0]?.written).toEqual([`${envScript(p.env.reveal())}\0`]);
  });

  test("attach is read-only for watch", () => {
    const { runner } = mocked();
    const s = { userId: "u1", name: "agent-a1" };
    expect(runner.attach(s, "watch").argv).toEqual([
      "sudo",
      "-n",
      HELPER,
      "attach",
      "u1",
      "agent-a1",
      "ro",
    ]);
    expect(runner.attach(s, "control").argv.at(-1)).toBe("rw");
  });

  test("tmux verbs", async () => {
    const { runner, calls } = mocked({
      capture: { stdout: "screen\n" },
      "pane-title": { stdout: "fake-agent: idle\n" },
      "has-session": (c) => ({ code: c.argv[5] === "agent-a1" ? 0 : 1 }),
      "list-sessions": { stdout: "agent-a1\nagent-b2\n" },
    });
    const s = { userId: "u1", name: "agent-a1" };
    expect(await runner.capturePane(s, 50)).toBe("screen\n");
    expect(await runner.paneTitle(s)).toBe("fake-agent: idle");
    expect(await runner.sessionExists(s)).toBe(true);
    expect(await runner.sessionExists({ userId: "u1", name: "agent-a2" })).toBe(false);
    expect(await runner.listSessions(user)).toEqual(["agent-a1", "agent-b2"]);
    await runner.sendKeys(s, "hello", { enter: true });
    await runner.sendKeys(s, "");
    await runner.sendKeys(s, "\u001b");
    expect(calls.map((c) => c.argv.slice(3))).toEqual([
      ["capture", "u1", "agent-a1", "50"],
      ["pane-title", "u1", "agent-a1"],
      ["has-session", "u1", "agent-a1"],
      ["has-session", "u1", "agent-a2"],
      ["list-sessions", "u1"],
      ["send-keys", "u1", "agent-a1", "1", "text"],
      ["send-keys", "u1", "agent-a1", "0", "raw"],
    ]);
    expect(calls.at(-2)?.stdin).toBe("hello");
    expect(calls.at(-1)?.stdin).toBe("\u001b");
  });

  test("session names are validated before the helper runs", async () => {
    const { runner, calls } = mocked();
    for (const name of ["=agent-a1", "agent-a1;id", "other", "agent-a:1"]) {
      await expect(runner.capturePane({ userId: "u1", name }, 5)).rejects.toThrow();
      expect(() => runner.attach({ userId: "u1", name }, "watch")).toThrow();
    }
    await expect(runner.readTextFile(user, "relative/path")).rejects.toThrow();
    await expect(runner.kill({ userId: "u1", agentId: "a.b" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("files, kill and ports", async () => {
    const { runner, calls } = mocked({
      "read-file": (c) => (c.argv[5] === "/x" ? { stdout: "hi" } : { code: 3 }),
      "list-dir": { stdout: "b\0a\0" },
      sockets: { stdout: "" },
    });
    expect(await runner.readTextFile(user, "/x")).toBe("hi");
    expect(await runner.readTextFile(user, "/missing")).toBeNull();
    expect(await runner.listDir(user, "/d")).toEqual(["a", "b"]);
    expect(await runner.listPorts({ userId: "u1", agentId: "a1" })).toEqual([]);
    await runner.kill({ userId: "u1", agentId: "a1" });
    await runner.mountProject(user, {
      floorId: "f1",
      repoId: "r1",
      workdir: "/srv/office/worktrees/f1/u1/_clones/r1",
    });
    await runner.reclaim("/srv/office/projects");
    expect(calls.map((c) => c.argv.slice(3))).toEqual([
      ["read-file", "u1", "/x"],
      ["read-file", "u1", "/missing"],
      ["list-dir", "u1", "/d"],
      ["sockets", "u1", "a1"],
      ["kill", "u1", "a1"],
      ["mount-project", "u1", "/srv/office/worktrees/f1/u1/_clones/r1"],
      ["reclaim", "/srv/office/projects"],
    ]);
  });
});
