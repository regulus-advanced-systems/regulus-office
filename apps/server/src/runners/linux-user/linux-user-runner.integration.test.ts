/**
 * Real linux-user backend: provisions an `office-u-<rid>` account, runs the
 * fake agent through tmux + a systemd scope as that account, reads and drives
 * it, lists its processes via the cgroup, finds a listening port, kills it and
 * deprovisions. Then (#114) a second human's account can neither read nor
 * write the first human's clone and worktrees nor write the floor mirror, and
 * `reclaim` takes a pre-#114 shared dir back from runner accounts. Needs root via the installed helper, so it only runs with
 * OFFICE_TEST_LINUX_USER=1 and passwordless sudo (the CI `linux-user` job;
 * see docs/deploy/linux-user-runner.md for the setup it expects).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { FakeAdapter, Secret, type SpawnPlan } from "@regulus/agent-adapters";
import { attachWatcher } from "../testing/watcher.ts";
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
const WORKTREES = process.env.OFFICE_TEST_WORKTREES_ROOT ?? "/srv/office/worktrees";
const rid = `ci${Math.floor(Math.random() * 0xffffff).toString(16)}`;
const ridB = `${rid}b`;
const user = { userId: rid };
const userB = { userId: ridB };

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
  const floor = `floor-${rid}`;
  const floorDir = join(WORKTREES, floor);
  const mirrorDir = join(PROJECTS, floor);
  // The human's own clone in their area, <worktrees>/<floor>/<rid>/_clones/<repo> (#114).
  const workdir = join(floorDir, rid, "_clones", "repo");
  let handle: RunnerHandle;

  beforeAll(async () => {
    await mkdir(workdir, { recursive: true });
    await copyFile(FAKE_AGENT, join(workdir, "fake-agent.sh"));
  });

  afterAll(async () => {
    await runner.deprovision(user);
    await runner.deprovision(userB);
    expect(Bun.spawnSync(["getent", "passwd", `office-u-${rid}`]).exitCode).not.toBe(0);
    for (const dir of [floorDir, mirrorDir]) {
      await Bun.$`sudo -n rm -rf ${dir}`.nothrow();
      await rm(dir, { recursive: true, force: true });
    }
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
    // The first useradd on a fresh GitHub runner takes ~25 s (image quirk); later ones < 1 s.
  }, 120_000);

  test("mountProject makes the workdir writable by the human and readable back", async () => {
    await runner.mountProject(user, { floorId: "f", repoId: "r", workdir });
    const acl = await Bun.$`getfacl -p ${workdir}`.text();
    expect(acl).toContain(`group:office-u-${rid}:rwx`);
    expect(acl).toContain(`default:group:office-u-${rid}:rwx`);
    // The area is closed to "other"; the helper refuses anything outside it.
    expect((await stat(join(floorDir, rid))).mode & 0o007).toBe(0);
    await mkdir(join(mirrorDir, "repo"), { recursive: true });
    for (const dir of [join(mirrorDir, "repo"), floorDir, join(floorDir, ridB)]) {
      await expect(
        runner.mountProject(user, { floorId: "f", repoId: "r", workdir: dir }),
      ).rejects.toThrow();
    }
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

    // Input must get through while a read-only watcher is attached (#107).
    const watcher = await attachWatcher(runner, session, "FAKE AGENT READY");
    const asHuman = (...args: string[]) =>
      Bun.$`sudo -n -u office-u-${rid} tmux -S ${handle.tmuxSocket} ${args}`.text();
    expect(await asHuman("list-clients", "-F", "#{client_flags}")).toContain("read-only");
    await runner.sendKeys(session, "hello linux-user\nsecond line", { enter: true });
    const echoed = await waitFor(
      () => runner.capturePane(session, 50),
      (s) => s.includes("you said: second line"),
    );
    expect(echoed).toContain("you said: hello linux-user");
    await runner.sendKeys(session, "\u0003");
    await runner.sendKeys(session, "after ctrl-c", { enter: true });
    expect(
      await waitFor(
        () => runner.capturePane(session, 50),
        (s) => s.includes("you said: after ctrl-c"),
      ),
    ).toContain("FAKE AGENT INTERRUPTED");
    expect(
      await waitFor(
        async () => watcher.output(),
        (s) => s.includes("after ctrl-c"),
      ),
    ).toContain("after ctrl-c");
    expect((await asHuman("list-buffers")).trim()).toBe("");
    await watcher.close();

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

  test("another human's account can neither read nor write this human's clone and worktrees", async () => {
    const worktreeA = join(floorDir, rid, "agent-a");
    const secret = join(workdir, "secret.txt");
    await mkdir(worktreeA, { recursive: true });
    await Bun.write(secret, "only for A\n");
    await Bun.write(join(worktreeA, "work.txt"), "A's work\n");
    await runner.mountProject(user, { floorId: "f", repoId: "r", workdir: worktreeA });
    const cloneB = join(floorDir, ridB, "_clones", "repo");
    await mkdir(cloneB, { recursive: true });
    await runner.provision(userB);
    await runner.mountProject(userB, { floorId: "f", repoId: "r", workdir: cloneB });

    // A itself can (the control).
    expect(await runner.readTextFile(user, secret)).toBe("only for A\n");
    const writeAs = (who: string, path: string) =>
      runner.helper.call("write-file", [who, path, "644"], { stdin: "planted\n" });
    await writeAs(rid, join(worktreeA, "by-a.txt"));
    // B cannot read or write anything of A's, nor write the mirror.
    for (const path of [secret, join(worktreeA, "work.txt")]) {
      expect(await runner.readTextFile(userB, path).catch(() => null)).toBeNull();
    }
    expect(await runner.listDir(userB, join(floorDir, rid)).catch(() => [])).toEqual([]);
    for (const path of [
      join(workdir, ".git-planted"),
      join(worktreeA, "by-b.txt"),
      join(floorDir, rid, "by-b.txt"),
      join(mirrorDir, "repo", "by-b.txt"),
    ]) {
      await expect(writeAs(ridB, path)).rejects.toThrow();
      expect(await Bun.file(path).exists()).toBe(false);
    }
    // B works in its own clone.
    await writeAs(ridB, join(cloneB, "by-b.txt"));
    expect(await readFile(join(cloneB, "by-b.txt"), "utf8")).toBe("planted\n");
    expect(await runner.readTextFile(user, join(cloneB, "by-b.txt")).catch(() => null)).toBeNull();
  }, 120_000);

  test("reclaim takes a pre-#114 shared dir back from runner accounts", async () => {
    // A mirror as runners left it: B's ACLs on it, and a hook owned by A's account.
    const repo = join(mirrorDir, "repo");
    const hook = join(repo, "post-checkout");
    await Bun.write(hook, "#!/bin/sh\n");
    await Bun.$`sudo -n setfacl -R -m g:office-u-${ridB}:rwX,d:g:office-u-${ridB}:rwX ${mirrorDir}`;
    await Bun.$`sudo -n chown office-u-${rid} ${hook}`;
    await runner.reclaim(mirrorDir);
    const acl = await Bun.$`getfacl -R -p ${mirrorDir}`.text();
    expect(acl).not.toContain("office-u-");
    expect((await stat(hook)).uid).toBe(process.getuid?.() ?? -1);
    expect((await stat(mirrorDir)).mode & 0o007).toBe(0);
    // Only the projects root or an old per-agent worktree qualify.
    await expect(runner.reclaim(join(floorDir, rid))).rejects.toThrow();
  }, 60_000);
});
