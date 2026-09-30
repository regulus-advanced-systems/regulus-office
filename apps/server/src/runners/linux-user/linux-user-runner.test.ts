/**
 * Command construction with the helper mocked: exact sudo argv per verb, what
 * goes on stdin, and that secrets never reach an argv or an error message.
 */
import { describe, expect, test } from "bun:test";
import { FakeAdapter, Secret, type SpawnPlan } from "@regulus/agent-adapters";
import { DEFAULT_SANDBOX_SETTINGS } from "../sandbox.ts";
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

  test("removeFloorDirs passes only a floor slug and reports what the helper removed", async () => {
    const { runner, calls } = mocked({
      "remove-floor": {
        stdout: "removed=/srv/office/projects/apollo\nremoved=/srv/office/worktrees/apollo\n",
      },
    });
    expect(await runner.removeFloorDirs("apollo")).toEqual([
      "/srv/office/projects/apollo",
      "/srv/office/worktrees/apollo",
    ]);
    for (const slug of ["", "..", "a/b", "/etc", "Apollo", "apollo-", "a.b"]) {
      await expect(runner.removeFloorDirs(slug)).rejects.toThrow("invalid floor slug");
    }
    expect(calls.map((c) => c.argv.slice(3))).toEqual([["remove-floor", "apollo"]]);
  });
});

describe("LinuxUserRunner sandboxes (#169)", () => {
  const settings = { ...DEFAULT_SANDBOX_SETTINGS, memoryBytes: 1024 ** 3, cpus: 1.5, pids: 300 };

  /** A runner with sandboxes on over a helper that keeps sandbox records. */
  function withSandboxes(list = "") {
    const records = new Map<string, string>();
    const calls: HelperCall[] = [];
    const spawned: { argv: readonly string[]; written: string[] }[] = [];
    const runner = new LinuxUserRunner({
      sandboxes: settings,
      run: async (call) => {
        calls.push(call);
        const verb = call.argv[3];
        if (verb === "sandbox-list") {
          return { code: 0, stdout: list + [...records.values()].join(""), stderr: "" };
        }
        if (verb === "sandbox-up") {
          const [, , , , rid, aid, slot, , , , owner] = call.argv;
          const addr = `10.231.0.${Number(slot) + 2}`;
          records.set(aid ?? "", `${aid} ${rid} ${slot} ${addr} ${owner}\n`);
          return { code: 0, stdout: `address=${addr}\nslot=${slot}\n`, stderr: "" };
        }
        if (verb === "kill") records.delete(call.argv[5] ?? "");
        return { code: 0, stdout: "", stderr: "" };
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

  test("sandbox-up gets the slot, limits and owner; the robot's env gets PORT", async () => {
    const { runner, calls, spawned } = withSandboxes();
    const info = await runner.sandbox({ userId: "u1", agentId: "a1" }, { workdir: "/w" });
    const up = calls.find((c) => c.argv[3] === "sandbox-up");
    const slot = Number(up?.argv[6]);
    expect(up?.argv).toEqual([
      "sudo",
      "-n",
      HELPER,
      "sandbox-up",
      "u1",
      "a1",
      String(slot),
      String(1024 ** 3),
      "150",
      "300",
      "u1",
    ]);
    const first = settings.portBase + slot * settings.portSpan;
    expect(info).toMatchObject({
      userId: "u1",
      agentId: "a1",
      host: `10.231.0.${slot + 2}`,
      ports: { first, last: first + settings.portSpan - 1 },
    });

    await runner.exec(user, plan(runner, "a1"));
    const exec = calls.find((c) => c.argv[3] === "exec");
    expect(exec?.stdin).toContain(`export PORT='${first}'\n`);
    expect(exec?.stdin).toContain(`export FAKE_API_KEY='${KEY}'`);
    await runner.spawnPiped(user, plan(runner, "a1"));
    expect(spawned[0]?.written.join("")).toContain(`export PORT='${first}'\n`);

    // A robot without a sandbox (or a login terminal) gets no PORT.
    await runner.exec(user, plan(runner, "a2"));
    expect(calls.filter((c) => c.argv[3] === "exec")[1]?.stdin).not.toContain("PORT=");
  });

  test("two robots never get the same slot; a known sandbox keeps its slot", async () => {
    const { runner, calls } = withSandboxes();
    const a1 = await runner.sandbox({ userId: "u1", agentId: "a1" }, { workdir: "/w" });
    const a2 = await runner.sandbox({ userId: "u1", agentId: "a2" }, { workdir: "/w" });
    const again = await runner.sandbox({ userId: "u1", agentId: "a1" }, { workdir: "/w" });
    expect(a2?.ports.first).not.toBe(a1?.ports.first);
    expect(again?.ports).toEqual(a1?.ports as NonNullable<typeof a1>["ports"]);
    expect(calls.filter((c) => c.argv[3] === "sandbox-list")).toHaveLength(1);
  });

  test("a fresh runner reads existing sandboxes (re-adopt) and kill forgets them", async () => {
    const rid = runnerId("0f8c2d9e-5b6a-4c1d-9e7f-123456789abc");
    const list = `a9 ${rid} 5 10.231.0.7 0f8c2d9e-5b6a-4c1d-9e7f-123456789abc\nbad line\n`;
    const { runner } = withSandboxes(list);
    expect(await runner.listSandboxes()).toEqual([
      {
        userId: "0f8c2d9e-5b6a-4c1d-9e7f-123456789abc",
        agentId: "a9",
        host: "10.231.0.7",
        slot: 5,
        ports: { first: 20_050, last: 20_059 },
      },
    ] as never);
    await runner.sandbox({ userId: "u1", agentId: "a1" }, { workdir: "/w" });
    await runner.kill({ userId: "u1", agentId: "a1" });
    expect((await runner.listSandboxes()).map((s) => s.agentId)).toEqual(["a9"]);
  });

  test("sandboxOf finds an existing sandbox without creating one (services proxy, #39)", async () => {
    const { runner, calls } = withSandboxes();
    expect(await runner.sandboxOf({ userId: "u1", agentId: "a1" })).toBeNull();
    const made = await runner.sandbox({ userId: "u1", agentId: "a1" }, { workdir: "/w" });
    expect(await runner.sandboxOf({ userId: "u1", agentId: "a1" })).toEqual({
      userId: "u1",
      agentId: "a1",
      host: made?.host ?? "",
      ports: made?.ports ?? { first: 0, last: 0 },
      createdAt: made?.createdAt,
    });
    // Another human's robot id: not theirs.
    expect(await runner.sandboxOf({ userId: "u2", agentId: "a1" })).toBeNull();
    expect(calls.filter((c) => c.argv[3] === "sandbox-up")).toHaveLength(1);
  });

  test("with sandboxes off there is no sandbox and no sandbox-list call", async () => {
    const { runner, calls } = mocked();
    expect(await runner.sandbox({ userId: "u1", agentId: "a1" }, { workdir: "/w" })).toBeNull();
    expect(await runner.listSandboxes()).toEqual([]);
    expect(await runner.sandboxOf({ userId: "u1", agentId: "a1" })).toBeNull();
    await runner.exec(user, plan(runner, "a1"));
    expect(calls.some((c) => c.argv[3]?.startsWith("sandbox"))).toBe(false);
    expect(calls.find((c) => c.argv[3] === "exec")?.stdin).not.toContain("PORT=");
  });
});
