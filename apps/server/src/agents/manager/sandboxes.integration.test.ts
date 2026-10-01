/**
 * AgentManager with a runner that has per-agent sandboxes (#169): a spawn
 * makes the henchman's sandbox before it runs anything, stop and send-home
 * remove it, and at boot the sandboxes of live henchmen are kept while orphans
 * are reaped. The runner is LocalTmuxRunner plus a recorded sandbox list;
 * the real backends are covered in runners/docker and runners/linux-user.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { FakeAdapter } from "@regulus/agent-adapters";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import type { AgentRef, Runner, SandboxInfo, SandboxSpec } from "../../runners/types.ts";
import { FAKE_AGENT, makeManager, officeFixture, spawnInput } from "./test-helpers.ts";

type Office = Awaited<ReturnType<typeof officeFixture>>;

/** LocalTmuxRunner with a sandbox registry and a log of the calls that matter here. */
function sandboxing(inner: LocalTmuxRunner) {
  const sandboxes = new Map<string, SandboxInfo & { workdir: string }>();
  const log: string[] = [];
  const bound = (name: keyof Runner) => {
    const fn = (inner as unknown as Record<string, unknown>)[name];
    return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).bind(inner) : fn;
  };
  const runner = {
    backend: inner.backend,
    provision: bound("provision"),
    mountProject: bound("mountProject"),
    exec: async (...args: Parameters<Runner["exec"]>) => {
      log.push(`exec ${args[1].agentId}`);
      return inner.exec(...args);
    },
    spawnPiped: bound("spawnPiped"),
    attach: bound("attach"),
    capturePane: bound("capturePane"),
    paneTitle: bound("paneTitle"),
    sendKeys: bound("sendKeys"),
    sessionExists: bound("sessionExists"),
    listSessions: bound("listSessions"),
    listProcesses: bound("listProcesses"),
    listPorts: bound("listPorts"),
    readTextFile: bound("readTextFile"),
    listDir: bound("listDir"),
    async sandbox(agent: AgentRef, spec: SandboxSpec) {
      log.push(`sandbox ${agent.agentId}`);
      const info = {
        ...agent,
        host: `sbx-${agent.agentId}`,
        ports: { first: 20_000, last: 20_009 },
        createdAt: 0,
        workdir: spec.workdir,
      };
      sandboxes.set(agent.agentId, info);
      return info;
    },
    async listSandboxes() {
      return [...sandboxes.values()];
    },
    async kill(agent: AgentRef) {
      log.push(`kill ${agent.agentId}`);
      sandboxes.delete(agent.agentId);
      await inner.kill(agent);
    },
  } as Runner;
  return { runner, sandboxes, log };
}

const adapter = () =>
  new FakeAdapter({
    command: ["sh", FAKE_AGENT],
    providerSessionId: "sess-1",
    script: [{ kind: "status", ts: 1, status: "idle" }],
  });

describe.skipIf(!hasTmux())("AgentManager with per-agent sandboxes (#169)", () => {
  let inner: LocalTmuxRunner;
  let office: Office;

  beforeEach(async () => {
    inner = await LocalTmuxRunner.create();
    office = await officeFixture();
  });

  afterEach(async () => {
    await inner.dispose();
    await rm(office.workdir, { recursive: true, force: true });
  });

  test("spawn makes the henchman's sandbox first; stop and send-home remove it", async () => {
    const { runner, sandboxes, log } = sandboxing(inner);
    const { manager, henchmen } = makeManager(office.db, runner, [adapter()]);
    const { agentId } = await manager.spawn(
      office.member,
      spawnInput(office.operationId, office.repoId),
    );
    await henchmen.waitFor(agentId, (r) => r.status === "idle");
    expect(log.slice(0, 2)).toEqual([`sandbox ${agentId}`, `exec ${agentId}`]);
    expect(sandboxes.get(agentId)).toMatchObject({
      userId: office.member.id,
      agentId,
      workdir: office.workdir,
    });

    await manager.stop(office.member, agentId);
    expect(sandboxes.has(agentId)).toBe(false);

    await manager.resume(office.member, agentId);
    await henchmen.waitFor(agentId, (r) => r.status === "idle");
    expect(sandboxes.has(agentId)).toBe(true);

    await manager.sendHome(office.member, agentId, { keepBranch: true });
    expect(sandboxes.has(agentId)).toBe(false);
    await manager.close();
  });

  test("boot keeps the sandboxes of re-adopted henchmen and reaps orphans", async () => {
    const first = sandboxing(inner);
    const { manager, henchmen } = makeManager(office.db, first.runner, [adapter()]);
    const { agentId } = await manager.spawn(
      office.member,
      spawnInput(office.operationId, office.repoId),
    );
    await henchmen.waitFor(agentId, (r) => r.status === "idle");
    await manager.close();

    // The office restarts: the henchman's sandbox is still there, plus one nobody owns.
    const again = sandboxing(inner);
    again.sandboxes.set(agentId, {
      ...(first.sandboxes.get(agentId) as SandboxInfo & { workdir: string }),
    });
    again.sandboxes.set("gone-henchman", {
      userId: office.member.id,
      agentId: "gone-henchman",
      host: "sbx-gone-henchman",
      ports: { first: 20_010, last: 20_019 },
      createdAt: 0,
      workdir: office.workdir,
    });
    const next = makeManager(office.db, again.runner, [adapter()]);
    await next.manager.adopt();
    expect([...again.sandboxes.keys()]).toEqual([agentId]);
    expect(again.log).toContain("kill gone-henchman");
    expect(
      await again.runner.sessionExists({ userId: office.member.id, name: `agent-${agentId}` }),
    ).toBe(true);
    await next.manager.close();
  });
});
