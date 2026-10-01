import { describe, expect, test } from "bun:test";
import type { AgentStatus } from "@regulus/protocol";
import { createLogger } from "../../logging.ts";
import type { AgentRef, Runner, SandboxInfo } from "../../runners/types.ts";
import { reapSandboxes, SANDBOX_REAP_GRACE_MS } from "./sandbox-reaper.ts";

const NOW = 10_000_000;
const old = Date.now() - 10 * SANDBOX_REAP_GRACE_MS;

function fakeRunner(sandboxes: SandboxInfo[]) {
  const killed: AgentRef[] = [];
  const runner = {
    listSandboxes: async () => sandboxes,
    kill: async (a: AgentRef) => {
      killed.push(a);
    },
  } as unknown as Runner;
  return { runner, killed };
}

const sb = (agentId: string, createdAt = old): SandboxInfo => ({
  userId: "u1",
  agentId,
  host: `office-sbx-${agentId}`,
  ports: { first: 20_000, last: 20_009 },
  createdAt,
});

describe("reapSandboxes (#169)", () => {
  test("removes sandboxes of untracked henchmen and of henchmen down for a while", async () => {
    const views: Record<string, { status: AgentStatus; lastActivityAt: number }> = {
      working: { status: "working", lastActivityAt: NOW - 10 * SANDBOX_REAP_GRACE_MS },
      starting: { status: "starting", lastActivityAt: NOW - 10 * SANDBOX_REAP_GRACE_MS },
      exitedLongAgo: { status: "exited", lastActivityAt: NOW - SANDBOX_REAP_GRACE_MS },
      exitedJustNow: { status: "exited", lastActivityAt: NOW - 1000 },
      offline: { status: "offline", lastActivityAt: NOW - 2 * SANDBOX_REAP_GRACE_MS },
    };
    const { runner, killed } = fakeRunner([
      sb("working"),
      sb("starting"),
      sb("exitedLongAgo"),
      sb("exitedJustNow"),
      sb("offline"),
      sb("untracked"),
      sb("untrackedButNew", Date.now()),
    ]);
    const removed = await reapSandboxes({
      runner,
      logger: createLogger({ level: "silent" }),
      now: () => NOW,
      view: (id) => views[id],
    });
    expect(killed.map((k) => k.agentId).sort()).toEqual(["exitedLongAgo", "offline", "untracked"]);
    expect(removed).toBe(3);
    expect(killed[0]?.userId).toBe("u1");
  });

  test("a failed removal is logged and the others still go; no sandboxes, nothing to do", async () => {
    const { runner } = fakeRunner([sb("a"), sb("b")]);
    let calls = 0;
    (runner as { kill: Runner["kill"] }).kill = async () => {
      calls++;
      if (calls === 1) throw new Error("docker down");
    };
    const deps = {
      runner,
      logger: createLogger({ level: "silent" }),
      now: () => NOW,
      view: () => undefined,
    };
    expect(await reapSandboxes(deps)).toBe(1);
    const bare = { ...deps, runner: {} as Runner };
    expect(await reapSandboxes(bare)).toBe(0);
  });
});
