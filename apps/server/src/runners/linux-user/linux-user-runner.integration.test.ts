/**
 * Real linux-user backend: provisions an `office-u-<rid>` account, runs the
 * fake agent through tmux + a systemd scope as that account, reads and drives
 * it, lists its processes via the cgroup, finds a listening port, kills it and
 * deprovisions. Needs root via the installed helper, so it only runs with
 * OFFICE_TEST_LINUX_USER=1 and passwordless sudo (the CI `linux-user` job;
 * see docs/deploy/linux-user-runner.md for the setup it expects).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { FakeAdapter, Secret, type SpawnPlan } from "@regulus/agent-adapters";
import { bindRunnerOps, type RunnerHandle } from "../types.ts";
import { DEFAULT_HELPER_PATH } from "./helper-client.ts";
import { LinuxUserRunner } from "./linux-user-runner.ts";

const requested = process.env.OFFICE_TEST_LINUX_USER === "1";
const enabled =
  requested &&
  Bun.spawnSync(["sudo", "-n", "true"]).exitCode === 0 &&
  (await Bun.file(DEFAULT_HELPER_PATH).exists());

// Asked for but not runnable is a failure, not a silent skip (CI would go green).
test.skipIf(!requested)("OFFICE_TEST_LINUX_USER=1 has passwordless sudo and the helper", () => {
  expect(enabled).toBe(true);
});

const FAKE_AGENT = join(import.meta.dir, "../testing/fake-agent.sh");
const KEY = "sk-linux-user-DO-NOT-LEAK";
const PROJECTS = process.env.OFFICE_TEST_PROJECTS_ROOT ?? "/srv/office/projects";
const rid = `ci${Math.floor(Math.random() * 0xffffff).toString(16)}`;
const user = { userId: rid };

async function waitFor<T>(probe: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (ok(value) || Date.now() > deadline) return value;
    await Bun.sleep(50);
  }
}

describe.skipIf(!enabled)("LinuxUserRunner (real accounts, systemd, tmux)", () => {
  const runner = new LinuxUserRunner();
  const floorDir = join(PROJECTS, `floor-${rid}`);
  const workdir = join(floorDir, "repo");
  let handle: RunnerHandle;

  beforeAll(async () => {
    await mkdir(workdir, { recursive: true });
    await copyFile(FAKE_AGENT, join(workdir, "fake-agent.sh"));
  });

  afterAll(async () => {
    await runner.deprovision(user);
    expect(Bun.spawnSync(["getent", "passwd", `office-u-${rid}`]).exitCode).not.toBe(0);
    await Bun.$`sudo -n rm -rf ${floorDir}`.nothrow();
    await rm(floorDir, { recursive: true, force: true });
  });

  function plan(agentId: string, argv: string[]): SpawnPlan {
    const adapter = new FakeAdapter({ command: argv });
    return adapter.buildSpawn(
      {
        agentId,
        provider: "custom",
        workdir,
        credential: { kind: "api_key", apiKey: Secret.of(KEY), attributedTo: "user" },
      },
      {
        backend: runner.backend,
        userId: user.userId,
        home: handle.home,
        officeUrl: "http://office.test",
        agentToken: Secret.of("hook-token"),
        now: Date.now,
        runner: bindRunnerOps(runner, user),
      },
    );
  }

  test("provision is idempotent and isolates HOME and the tmux socket", async () => {
    handle = await runner.provision(user);
    expect(await runner.provision(user)).toEqual(handle);
    expect(handle.home).toBe(`/home/office-u-${rid}`);
    expect(handle.tmuxSocket).toBe(`/run/office/tmux/${rid}.sock`);
    const home = await stat(handle.home);
    expect(home.mode & 0o777).toBe(0o700);
    expect(home.uid).toBe(handle.uid ?? -1);
    expect((await stat(handle.tmuxSocket)).uid).toBe(handle.uid ?? -1);
    // The office user cannot read the human's HOME directly.
    await expect(readFile(join(handle.home, ".bashrc"), "utf8")).rejects.toThrow();
  }, 30_000);

  test("mountProject makes the workdir writable by the human and readable back", async () => {
    await runner.mountProject(user, { floorId: "f", repoId: "r", workdir });
    const acl = await Bun.$`getfacl -p ${workdir}`.text();
    expect(acl).toContain(`group:office-u-${rid}:rwx`);
    expect(acl).toContain(`default:group:office-u-${rid}:rwx`);
  });

  test("exec runs the fake agent in its own scope, as the human, without leaking env", async () => {
    const p = plan("a1", ["sh", join(workdir, "fake-agent.sh")]);
    const session = await runner.exec(user, p);
    expect(session).toEqual({ userId: rid, name: "agent-a1" });
    expect(await runner.sessionExists(session)).toBe(true);
    expect(await runner.listSessions(user)).toEqual(["agent-a1"]);

    const screen = await waitFor(
      () => runner.capturePane(session, 50),
      (s) => s.includes("FAKE AGENT READY"),
    );
    expect(screen).toContain("FAKE AGENT key=present");
    expect(screen).not.toContain(KEY);
    expect(await runner.paneTitle(session)).toBe("fake-agent: idle");

    // Env never on a command line; the env file was sourced and removed.
    expect(await Bun.$`ps -eo args`.text()).not.toContain(KEY);
    expect(await runner.listDir(user, join(handle.home, ".office/env"))).toEqual([]);
    const hook = await runner.readTextFile(user, join(handle.home, ".fake-agent/a1.json"));
    expect(hook).toContain("hook-token");

    await runner.sendKeys(session, "hello linux-user", { enter: true });
    expect(
      await waitFor(
        () => runner.capturePane(session, 50),
        (s) => s.includes("you said: hello linux-user"),
      ),
    ).toContain("you said: hello linux-user");

    const procs = await runner.listProcesses({ userId: rid, agentId: "a1" });
    expect(procs.map((p) => p.command)).toContain("sh");
    for (const proc of procs) {
      const status = await readFile(`/proc/${proc.pid}/status`, "utf8");
      expect(status).toMatch(new RegExp(`^Uid:\\s+${handle.uid}\\s`, "m"));
      const cgroup = await readFile(`/proc/${proc.pid}/cgroup`, "utf8");
      expect(cgroup.trim()).toEndWith("/agent-a1.scope");
    }

    expect(runner.attach(session, "watch").argv).toContain("ro");
    await runner.kill({ userId: rid, agentId: "a1" });
    expect(await runner.sessionExists(session)).toBe(false);
    expect(await runner.listProcesses({ userId: rid, agentId: "a1" })).toEqual([]);
    await runner.kill({ userId: rid, agentId: "a1" });
  }, 60_000);

  test("listPorts finds a listener started by the agent", async () => {
    const port = 38_000 + Math.floor(Math.random() * 1000);
    const argv = ["python3", "-m", "http.server", String(port), "--bind", "127.0.0.1"];
    await runner.exec(user, plan("b1", argv));
    const ports = await waitFor(
      () => runner.listPorts({ userId: rid, agentId: "b1" }),
      (ps) => ps.some((p) => p.port === port),
    );
    expect(ports.find((p) => p.port === port)?.address).toBe("127.0.0.1");
    await runner.kill({ userId: rid, agentId: "b1" });
    expect(await runner.listPorts({ userId: rid, agentId: "b1" })).toEqual([]);
  }, 60_000);

  test("spawnPiped runs as the human in the workdir, with env, in its own scope", async () => {
    const p = {
      ...plan("c1", []),
      argv: [
        "sh",
        "-c",
        'read line; test -n "$FAKE_API_KEY" && echo "got $line" > by-agent.txt; cat /proc/self/cgroup',
      ],
    };
    const proc = await runner.spawnPiped(user, p);
    await proc.write("ping\n");
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(out).toMatch(/\/agent-c1\.io-[0-9a-f]+\.scope\n$/);
    // Written by the human, readable by the office thanks to the default ACL.
    const file = join(workdir, "by-agent.txt");
    expect(await readFile(file, "utf8")).toBe("got ping\n");
    expect((await stat(file)).uid).toBe(handle.uid ?? -1);
  }, 30_000);
});
