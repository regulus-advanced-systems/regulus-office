/**
 * Real linux-user robot sandboxes (#169): two robots of one human each run a
 * web server on port 3000 in their own network namespace and the office
 * reaches both at their sandbox addresses; the limits are on their scopes; a
 * sandbox sees only its own processes and not another human's area;
 * 127.0.0.1:<office port> inside a sandbox is the office (hooks), and DNS and
 * outbound traffic work; a fresh runner re-adopts the sandboxes; kill removes
 * one. Needs root via the installed helper: OFFICE_TEST_LINUX_USER=1 and
 * passwordless sudo, as in the CI `linux-user` job.
 */
import { afterAll, beforeAll, test as bunTest, describe, expect } from "bun:test";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { SecretEnv, type SpawnPlan } from "@regulus/agent-adapters";
import { DEFAULT_SANDBOX_SETTINGS, type SandboxSettings } from "../sandbox.ts";
import type { SandboxInfo } from "../types.ts";
import { DEFAULT_HELPER_PATH, type HelperCallEvent } from "./helper-client.ts";
import { LinuxUserRunner } from "./linux-user-runner.ts";

const requested = process.env.OFFICE_TEST_LINUX_USER === "1";
const enabled =
  requested &&
  Bun.spawnSync(["sudo", "-n", "true"]).exitCode === 0 &&
  (await Bun.file(DEFAULT_HELPER_PATH).exists());

bunTest.skipIf(!requested)("OFFICE_TEST_LINUX_USER=1 has passwordless sudo and the helper", () => {
  expect(enabled).toBe(true);
});

const WORKTREES = process.env.OFFICE_TEST_WORKTREES_ROOT ?? "/srv/office/worktrees";
/** The helper forwards this port into sandboxes (OFFICE_PORT in runner-helper.conf, default). */
const OFFICE_PORT = Number(process.env.OFFICE_TEST_OFFICE_PORT ?? 4600);
const rid = `sb${Math.floor(Math.random() * 0xffffff).toString(16)}`;
const ridB = `${rid}b`;
const user = { userId: rid };
const userB = { userId: ridB };
const settings: SandboxSettings = {
  ...DEFAULT_SANDBOX_SETTINGS,
  memoryBytes: 256 * 1024 ** 2,
  cpus: 0.5,
  pids: 200,
};
const TIMEOUT = 300_000;

function logCall({ verb, ms, code, timedOut }: HelperCallEvent): void {
  console.log(`[helper] ${verb} ${ms} ms ${timedOut ? "TIMED OUT" : `exit ${code}`}`);
}

async function waitFor<T>(probe: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (ok(value) || Date.now() > deadline) return value;
    await Bun.sleep(100);
  }
}

const fetchText = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(3000) }).then(
    (r) => r.text(),
    () => "",
  );

describe.skipIf(!enabled)("LinuxUserRunner sandboxes (real namespaces and scopes, #169)", () => {
  const runner = new LinuxUserRunner({ sandboxes: settings, onCall: logCall });
  const floorDir = join(WORKTREES, `floor-${rid}`);
  const area = join(floorDir, rid);
  const areaB = join(floorDir, ridB);
  const infos = new Map<string, SandboxInfo | null>();
  let office: ReturnType<typeof Bun.serve> | undefined;
  let home = "";

  function plan(agentId: string, script: string): SpawnPlan {
    return {
      agentId,
      provider: "custom",
      argv: ["sh", "-c", script],
      env: SecretEnv.of({ FAKE_API_KEY: "sk-sandbox-DO-NOT-LEAK" }),
      cwd: join(area, agentId),
      tmuxSession: `agent-${agentId}`,
      files: [],
    };
  }

  /** A dev server that ignores $PORT and insists on 3000, as many do. */
  const server = (agentId: string) =>
    [
      `mkdir -p "$HOME/www-${agentId}"`,
      `echo "robot ${agentId} PORT=$PORT" > "$HOME/www-${agentId}/index.html"`,
      `exec python3 -m http.server 3000 --bind 0.0.0.0 --directory "$HOME/www-${agentId}"`,
    ].join(" && ");

  beforeAll(async () => {
    // The office as sandboxes reach it for hooks: loopback only, like a bare install.
    office = Bun.serve({
      hostname: "127.0.0.1",
      port: OFFICE_PORT,
      fetch: () => new Response("office ok"),
    });
    for (const agentId of ["a1", "a2", "a3"]) await mkdir(join(area, agentId), { recursive: true });
    await mkdir(join(areaB, "_clones", "repo"), { recursive: true });
    await Bun.write(join(areaB, "_clones", "repo", "secret.txt"), "only for B\n");
    home = (await runner.provision(user)).home;
    await runner.provision(userB);
    await runner.mountProject(userB, {
      floorId: "f",
      repoId: "r",
      workdir: join(areaB, "_clones", "repo"),
    });
    for (const agentId of ["a1", "a2", "a3"]) {
      await runner.mountProject(user, { floorId: "f", repoId: "r", workdir: join(area, agentId) });
    }
    for (const agentId of ["a1", "a2"]) {
      const info = await runner.sandbox({ userId: rid, agentId }, { workdir: join(area, agentId) });
      infos.set(agentId, info);
      await runner.exec(user, plan(agentId, server(agentId)));
    }
  }, TIMEOUT);

  afterAll(async () => {
    const all = ["a1", "a2", "a3", "p1"].map((agentId) => runner.kill({ userId: rid, agentId }));
    await Promise.allSettled(all);
    const results = await Promise.allSettled([runner.deprovision(user), runner.deprovision(userB)]);
    office?.stop(true);
    await Bun.$`sudo -n rm -rf ${floorDir}`.nothrow();
    await rm(floorDir, { recursive: true, force: true });
    for (const r of results) if (r.status === "rejected") throw r.reason;
  }, TIMEOUT);

  bunTest(
    "two robots of one human both serve on port 3000; the office reaches each at its address",
    async () => {
      const a1 = infos.get("a1");
      const a2 = infos.get("a2");
      expect(a1?.host).not.toBe(a2?.host);
      expect(a1?.ports.first).not.toBe(a2?.ports.first);
      for (const [agentId, info] of [
        ["a1", a1],
        ["a2", a2],
      ] as const) {
        const page = await waitFor(
          () => fetchText(`http://${info?.host}:3000/`),
          (t) => t.includes("robot"),
        );
        expect(page.trim()).toBe(`robot ${agentId} PORT=${info?.ports.first}`);
        const ports = await waitFor(
          () => runner.listPorts({ userId: rid, agentId }),
          (p) => p.some((x) => x.port === 3000),
        );
        expect(ports.map((p) => p.port)).toContain(3000);
      }
      // Nothing listens on the host itself.
      expect(await fetchText("http://127.0.0.1:3000/")).toBe("");
    },
    TIMEOUT,
  );

  bunTest("limits are on the robot's scope", async () => {
    const scope = "/sys/fs/cgroup/system.slice/agent-a1.scope";
    const read = async (f: string) => (await readFile(join(scope, f), "utf8")).trim();
    expect(await read("memory.max")).toBe(String(settings.memoryBytes));
    expect(await read("pids.max")).toBe(String(settings.pids));
    expect(await read("cpu.max")).toBe("50000 100000");
    expect(await read("memory.swap.max")).toBe("0");
  });

  bunTest(
    "a sandbox sees only its own processes, and not another human's area",
    async () => {
      await runner.sandbox({ userId: rid, agentId: "a3" }, { workdir: join(area, "a3") });
      const script = [
        `for d in /proc/[0-9]*; do cat "$d/comm"; done > "$HOME/procs-a3" 2>/dev/null`,
        `(cat "${join(areaB, "_clones", "repo", "secret.txt")}" 2>/dev/null || echo denied) > "$HOME/b-a3"`,
        "exec sleep 600",
      ].join("; ");
      await runner.exec(user, plan("a3", script));
      const procs = await waitFor(
        () => runner.readTextFile(user, join(home, "procs-a3")),
        (t) => Boolean(t?.includes("sleep") || t?.includes("sh")),
      );
      expect(procs).not.toContain("python3");
      expect((procs ?? "").split("\n").filter(Boolean).length).toBeLessThan(10);
      expect((await runner.readTextFile(user, join(home, "b-a3")))?.trim()).toBe("denied");
      // The office still sees the robot's processes (host view of its scope).
      const listed = await runner.listProcesses({ userId: rid, agentId: "a1" });
      expect(listed.map((p) => p.command)).toContain("python3");
    },
    TIMEOUT,
  );

  bunTest(
    "inside a sandbox 127.0.0.1:<office port> is the office; DNS and outbound work",
    async () => {
      await runner.sandbox({ userId: rid, agentId: "p1" }, { workdir: join(area, "a1") });
      const script = [
        `curl -s --max-time 5 http://127.0.0.1:${OFFICE_PORT}/`,
        'echo " port=$PORT"',
        "curl -s -o /dev/null --max-time 10 -w 'ip=%{http_code}\\n' http://1.1.1.1/",
        "getent hosts github.com >/dev/null && echo dns=ok || echo dns=failed",
        "curl -s -o /dev/null --max-time 20 -w 'out=%{http_code}\\n' https://github.com/",
      ].join("; ");
      const proc = await runner.spawnPiped(user, {
        ...plan("p1", script),
        cwd: join(area, "a1"),
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      const p1 = (await runner.listSandboxes()).find((s) => s.agentId === "p1");
      expect(out).toContain(`office ok port=${p1?.ports.first}`);
      // Routed and masqueraded out, names resolve, and both together.
      expect(out).not.toContain("ip=000");
      expect(out).toContain("dns=ok");
      expect(out).toMatch(/out=(200|301|302)/);
      await runner.kill({ userId: rid, agentId: "p1" });
    },
    TIMEOUT,
  );

  bunTest(
    "a fresh runner (office restart) re-adopts the sandboxes and their sessions",
    async () => {
      const again = new LinuxUserRunner({ sandboxes: settings, onCall: logCall });
      const sessions = await again.listSessions(user);
      expect(sessions).toEqual(expect.arrayContaining(["agent-a1", "agent-a2"]));
      const listed = await again.listSandboxes();
      expect(listed.find((s) => s.agentId === "a2")).toMatchObject({
        userId: rid,
        host: infos.get("a2")?.host,
        ports: infos.get("a2")?.ports,
      });
      const screen = await again.capturePane({ userId: rid, name: "agent-a2" }, 20);
      expect(screen).toContain("Serving HTTP");
      // Starting the robot again keeps its address and ports.
      const same = await again.sandbox(
        { userId: rid, agentId: "a2" },
        { workdir: join(area, "a2") },
      );
      expect(same?.host).toBe(infos.get("a2")?.host as string);
    },
    TIMEOUT,
  );

  bunTest(
    "kill removes the sandbox and its dev server; the other robot keeps serving",
    async () => {
      const a1 = infos.get("a1");
      const slot = ((a1?.ports.first ?? 0) - settings.portBase) / settings.portSpan;
      await runner.kill({ userId: rid, agentId: "a1" });
      expect(await runner.sessionExists({ userId: rid, name: "agent-a1" })).toBe(false);
      expect((await runner.listSandboxes()).map((s) => s.agentId)).not.toContain("a1");
      expect(await stat(`/run/netns/office-sbx${slot}`).catch(() => null)).toBeNull();
      expect(await stat("/sys/fs/cgroup/system.slice/agent-a1.scope").catch(() => null)).toBeNull();
      expect(await fetchText(`http://${a1?.host}:3000/`)).toBe("");
      expect(await fetchText(`http://${infos.get("a2")?.host}:3000/`)).toContain("robot a2");
    },
    TIMEOUT,
  );
});
