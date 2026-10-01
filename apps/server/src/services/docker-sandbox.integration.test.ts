/**
 * Integration (#39): services discovery and the proxy against a real docker
 * sandbox (#169). A henchman runs two web servers in its sandbox: one on
 * `0.0.0.0:$PORT` and one on `127.0.0.1:3001`. The scanner must find both
 * inside the sandbox's own network namespace, title the first from its page,
 * mark the second "localhost only", and the owner must reach the first
 * through `/p/<operation>/a/<agent>/port/<n>/`.
 *
 * The office reaches sandboxes by container name on the runners network; this
 * test process is not on that network, so it uses the container's address on
 * it instead (the only thing the wrapper below changes).
 *
 * Opt-in like the runner suites: REGULUS_DOCKER_TESTS=1 (CI job
 * `docker-runner`, runner calls through the socket proxy). Everything is
 * labelled `regulus-test=1` with this run's prefix and removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretEnv } from "@regulus/agent-adapters";
import { servicesProxyPath } from "@regulus/protocol";
import { DockerRunner } from "../runners/docker/docker-runner.ts";
import { EngineClient } from "../runners/docker/engine.ts";
import { tar } from "../runners/docker/testing/tar.ts";
import { runnerId } from "../runners/linux-user/ids.ts";
import { DEFAULT_SANDBOX_SETTINGS } from "../runners/sandbox.ts";
import type { AgentRef, Runner } from "../runners/types.ts";
import { type ServicesOffice, startServicesOffice } from "./test-helpers.ts";

const engine = new EngineClient();
const runnerEngine = new EngineClient(process.env.REGULUS_DOCKER_RUNNER_HOST ?? undefined);
const requested = process.env.REGULUS_DOCKER_TESTS === "1";
const reachable = requested && (await engine.ping());
if (requested && !reachable) throw new Error("REGULUS_DOCKER_TESTS=1 but Docker is not reachable");
const enabled = requested && reachable;
const TEST_LABEL = { "regulus-test": "1" };
const suffix = Math.random().toString(36).slice(2, 8);
const IMAGE = `regulus-test-runner:svc-${suffix}`;
const NETWORK = `rgtest-svc-${suffix}`;
const PREFIX = `rgsvc-${suffix}`;

async function buildImage(): Promise<void> {
  const dir = join(import.meta.dir, "../runners/docker/fixtures");
  const context = tar([
    { name: "Dockerfile", data: await Bun.file(join(dir, "Dockerfile")).text(), mode: 0o644 },
    {
      name: "fake-agent.sh",
      data: await Bun.file(join(import.meta.dir, "../runners/testing/fake-agent.sh")).text(),
      mode: 0o755,
    },
  ]);
  const res = await engine.request("POST", "/build", {
    query: { t: IMAGE, rm: true, forcerm: true, labels: JSON.stringify(TEST_LABEL) },
    body: context,
    contentType: "application/x-tar",
  });
  const log = await res.text();
  if (!res.ok || log.includes('"errorDetail"')) throw new Error(`image build failed:\n${log}`);
}

async function cleanup(): Promise<void> {
  const filters = JSON.stringify({ label: [`org.regulus.office.prefix=${PREFIX}`] });
  const containers = await engine.json<{ Id: string }[]>("GET", "/containers/json", {
    query: { all: true, filters },
  });
  for (const c of containers) {
    await engine.call("DELETE", `/containers/${c.Id}`, { query: { force: true } });
  }
  const { Volumes } = await engine.json<{ Volumes: { Name: string }[] | null }>("GET", "/volumes", {
    query: { filters },
  });
  for (const v of Volumes ?? []) await engine.call("DELETE", `/volumes/${v.Name}`);
  await engine.request("DELETE", `/networks/${NETWORK}`);
  await engine.request("DELETE", `/images/${IMAGE}`, { query: { force: true } });
}

/** The runner as the office uses it, but reaching sandboxes by address instead of name. */
function byAddress(runner: DockerRunner): Runner {
  const addressOf = async (name: string) => {
    const c = await engine.json<{
      NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
    }>("GET", `/containers/${name}/json`);
    return c.NetworkSettings.Networks[NETWORK]?.IPAddress ?? "";
  };
  return new Proxy(runner, {
    get(target, prop) {
      if (prop === "sandboxOf") {
        return async (agent: AgentRef) => {
          const info = await target.sandboxOf(agent);
          return info ? { ...info, host: await addressOf(info.host) } : null;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe.skipIf(!enabled)("services in a real docker sandbox (#39)", () => {
  let office: ServicesOffice;
  let runner: DockerRunner;
  let root: string;
  let owner: { id: string; cookie: string };
  let port = 0;

  beforeAll(async () => {
    await buildImage();
    await engine.call("POST", "/networks/create", {
      json: { Name: NETWORK, Labels: { ...TEST_LABEL } },
    });
    root = await mkdtemp(join(tmpdir(), "rg39-svc-"));
    runner = new DockerRunner({
      engine: runnerEngine,
      image: IMAGE,
      prefix: PREFIX,
      user: "1001:1001",
      home: "/home/runner",
      labels: TEST_LABEL,
      pull: false,
      network: NETWORK,
      operationRoots: [join(root, "worktrees")],
      sandboxes: DEFAULT_SANDBOX_SETTINGS,
    });
    office = await startServicesOffice({ runner: byAddress(runner) });
    owner = await office.signUp("Owner");
    office.addOperation("f1", { [owner.id]: "spawn" });
    office.addAgent("a1", "f1", owner.id);
    const area = join(root, "worktrees", "f1", runnerId(owner.id));
    const workdir = join(area, "a1");
    await mkdir(workdir, { recursive: true });
    for (const d of [root, join(root, "worktrees"), join(root, "worktrees", "f1")]) {
      await chmod(d, 0o755);
    }
    await chmod(area, 0o777);
    const agent = { userId: owner.id, agentId: "a1" };
    const info = await runner.sandbox(agent, { workdir });
    port = info?.ports.first ?? 0;
    const script = [
      "mkdir -p /tmp/www /tmp/local",
      "echo '<title>Sandbox App</title>henchman a1' > /tmp/www/index.html",
      "echo local > /tmp/local/index.html",
      // The app as if configured with the proxy's base path (Vite `base`).
      'mkdir -p "/tmp/www/p/f1/a/a1/port/$PORT"',
      'echo "henchman a1 behind the proxy" > "/tmp/www/p/f1/a/a1/port/$PORT/index.html"',
      "busybox httpd -p 127.0.0.1:3001 -h /tmp/local",
      'echo "Local: http://localhost:$PORT/"',
      "exec busybox httpd -f -p $PORT -h /tmp/www",
    ].join(" && ");
    await runner.exec(agent, {
      agentId: "a1",
      provider: "custom",
      argv: ["sh", "-c", script],
      env: SecretEnv.of({}),
      cwd: workdir,
      tmuxSession: "agent-a1",
      files: [],
    });
  }, 600_000);

  afterAll(async () => {
    await office?.stop();
    if (enabled) await cleanup();
    if (root) await rm(root, { recursive: true, force: true });
  }, 120_000);

  test("discovers both servers in the sandbox; the loopback one is localhost only", async () => {
    const deadline = Date.now() + 20_000;
    let list: { port: number; localOnly: boolean; title: string }[] = [];
    while (Date.now() < deadline) {
      await office.scanner.tick();
      list = (office.published.get("f1") ?? []) as typeof list;
      if (list.length >= 2) break;
      await Bun.sleep(250);
    }
    expect(list.map((s) => [s.port, s.localOnly]).sort()).toEqual(
      [
        [3001, true],
        [port, false],
      ].sort(),
    );
    expect(list.find((s) => s.port === port)?.title).toBe("Sandbox App");
  }, 30_000);

  test("the owner opens the app through the proxy; the loopback one is explained", async () => {
    const res = await fetch(new URL(servicesProxyPath("f1", "a1", port), office.server.url), {
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    expect((await res.text()).trim()).toBe("henchman a1 behind the proxy");
    const local = await fetch(new URL(servicesProxyPath("f1", "a1", 3001), office.server.url), {
      headers: { cookie: owner.cookie },
    });
    expect(local.status).toBe(502);
  });
});
