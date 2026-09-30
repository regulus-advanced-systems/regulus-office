/**
 * Integration (#151): a rebuilt runner image reaches an idle runner on its
 * next use, against a real Docker daemon (through the socket proxy in CI).
 * The HOME volume and the human's files in it survive the recreate; a runner
 * with a live tmux session keeps its old image until the session is gone.
 *
 * The storage corruption itself (`RWLayer … unexpectedly nil`) cannot be
 * produced on purpose; heal.test.ts covers it against the fake Engine API.
 *
 * Opt-in like docker-runner.integration.test.ts (REGULUS_DOCKER_TESTS=1).
 * Everything it creates carries its own name prefix and `regulus-test=1`,
 * and only that is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SecretEnv, tmuxSessionName } from "@regulus/agent-adapters";
import { DockerRunner } from "./docker-runner.ts";
import { EngineClient } from "./engine.ts";
import { tar } from "./testing/tar.ts";

const engine = new EngineClient();
const runnerEngine = new EngineClient(process.env.REGULUS_DOCKER_RUNNER_HOST ?? undefined);
const requested = process.env.REGULUS_DOCKER_TESTS === "1";
const reachable = requested && (await engine.ping());
if (requested && !reachable) throw new Error("REGULUS_DOCKER_TESTS=1 but Docker is not reachable");
const enabled = requested && reachable;
const TEST_LABEL = { "regulus-test": "1" };
const suffix = Math.random().toString(36).slice(2, 8);
const PREFIX = `rgheal-${suffix}`;
const IMAGE = `regulus-test-heal:${suffix}`;
const user = { userId: "u1" };
const builtIds = new Set<string>();

/** Build the fixture image as IMAGE; `rev` changes a label, so the image id changes. */
async function buildImage(rev: number): Promise<string> {
  const dir = join(import.meta.dir, "fixtures");
  const dockerfile = `${await Bun.file(join(dir, "Dockerfile")).text()}\nLABEL regulus-heal-rev=${rev}\n`;
  const context = tar([
    { name: "Dockerfile", data: dockerfile, mode: 0o644 },
    {
      name: "fake-agent.sh",
      data: await Bun.file(join(import.meta.dir, "../testing/fake-agent.sh")).text(),
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
  const { Id } = await engine.json<{ Id: string }>("GET", `/images/${IMAGE}/json`);
  builtIds.add(Id);
  return Id;
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
  for (const id of builtIds)
    await engine.request("DELETE", `/images/${id}`, { query: { force: true } });
}

async function inspect(id: string) {
  return engine.json<{
    Image: string;
    HostConfig: { Mounts: { Source?: string; Target: string }[] };
  }>("GET", `/containers/${id}/json`);
}

describe.skipIf(!enabled)("runner image drift (real Docker, #151)", () => {
  let runner: DockerRunner;
  const warnings: string[] = [];

  beforeAll(async () => {
    await buildImage(1);
    runner = new DockerRunner({
      engine: runnerEngine,
      image: IMAGE,
      prefix: PREFIX,
      user: "1001:1001",
      home: "/home/runner",
      labels: TEST_LABEL,
      pull: false,
      imageIdTtlMs: 0,
      logger: { warn: (obj, msg) => void warnings.push(`${msg} ${JSON.stringify(obj)}`) },
    });
  }, 600_000);

  afterAll(async () => {
    await cleanup();
  }, 120_000);

  test("an idle runner is recreated from the rebuilt image; HOME and its files stay", async () => {
    const first = await runner.provision(user);
    const marker = "/home/runner/.office/heal-marker";
    const proc = await runner.spawnPiped(user, {
      agentId: "marker",
      provider: "custom",
      argv: ["sh", "-c", `mkdir -p /home/runner/.office && echo kept > ${marker}`],
      env: SecretEnv.empty(),
      cwd: "/home/runner",
      tmuxSession: "marker",
      files: [],
    });
    expect(await proc.exited).toBe(0);

    const rebuilt = await buildImage(2);
    const second = await runner.provision(user);
    expect(second.containerId).not.toBe(first.containerId);
    const info = await inspect(second.containerId as string);
    expect(info.Image).toBe(rebuilt);
    expect(info.HostConfig.Mounts.map((m) => m.Source)).toEqual([`${PREFIX}-home-u1`]);
    expect(await runner.readTextFile(user, marker)).toBe("kept\n");
    expect(warnings.some((w) => w.includes("the runner image changed"))).toBe(true);
  }, 300_000);

  test("a runner with a live tmux session keeps its image until the session is gone", async () => {
    const before = await runner.provision(user);
    const plan = {
      agentId: "heal-a1",
      provider: "custom" as const,
      argv: ["sleep", "600"],
      env: SecretEnv.empty(),
      cwd: "/home/runner",
      tmuxSession: tmuxSessionName("heal-a1"),
      files: [],
    };
    const session = await runner.exec(user, plan);
    await buildImage(3);
    const kept = await runner.provision(user);
    expect(kept.containerId).toBe(before.containerId);
    expect(await runner.sessionExists(session)).toBe(true);

    await runner.kill({ userId: "u1", agentId: "heal-a1" });
    const after = await runner.provision(user);
    expect(after.containerId).not.toBe(before.containerId);
  }, 300_000);
});
