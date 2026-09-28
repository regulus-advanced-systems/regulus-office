/**
 * Re-record the logged-out fixtures under ../fixtures/recorded/ from a real
 * `codex app-server`, driven by this adapter's own client code:
 *
 *   bun packages/agent-adapters/src/codex/testing/record-traces.ts
 *
 * Safety: HOME and CODEX_HOME point at a fresh temp dir (never the host
 * user's ~/.codex) and nothing is ever logged in. The device-code login is
 * started only to capture the response shape and is cancelled immediately;
 * ids, codes and host details are scrubbed before writing.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeRunnerContext, createFakeRunnerOps } from "../../testing/fake-runner-context.ts";
import type { PipedProcess, RunnerContext, SpawnPlan } from "../../types.ts";
import { CodexAdapter } from "../adapter.ts";
import { CodexRpcClient } from "../rpc.ts";

type Step = { dir: "in" | "out"; msg: Record<string, unknown> };

function tee(proc: ReturnType<typeof Bun.spawn>, steps: Step[]): PipedProcess {
  const stdin = proc.stdin as import("bun").FileSink;
  let inBuf = "";
  const decoder = new TextDecoder();
  const recordIn = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      inBuf += decoder.decode(chunk, { stream: true });
      for (let nl = inBuf.indexOf("\n"); nl >= 0; nl = inBuf.indexOf("\n")) {
        const line = inBuf.slice(0, nl).trim();
        inBuf = inBuf.slice(nl + 1);
        if (line) steps.push({ dir: "in", msg: JSON.parse(line) });
      }
      controller.enqueue(chunk);
    },
  });
  return {
    pid: proc.pid,
    stdout: (proc.stdout as ReadableStream<Uint8Array>).pipeThrough(recordIn),
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited.then((code) => (proc.signalCode ? null : code)),
    async write(chunk) {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk);
      for (const line of text.split("\n"))
        if (line.trim()) steps.push({ dir: "out", msg: JSON.parse(line) });
      stdin.write(chunk);
      await stdin.flush();
    },
    kill: (signal) => proc.kill(signal),
  };
}

function recordingContext(home: string, steps: Step[]): RunnerContext {
  const runner = createFakeRunnerOps(async (plan: SpawnPlan) => {
    const proc = Bun.spawn([...plan.argv], {
      cwd: plan.cwd,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...plan.env.reveal() },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    return tee(proc, steps);
  });
  return createFakeRunnerContext({ home, runner, now: Date.now });
}

/** Replace every volatile or identifying value with a fixed placeholder. */
function scrub(steps: Step[], home: string): string {
  let text = steps.map((s) => JSON.stringify(s)).join("\n");
  const uuids = new Map<string, string>();
  text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => {
    if (!uuids.has(u))
      uuids.set(u, `00000000-0000-4000-8000-${String(uuids.size + 1).padStart(12, "0")}`);
    return uuids.get(u) as string;
  });
  text = text.replaceAll(home, "/home/office-u-u1");
  text = text.replace(/"userCode":"[^"]*"/g, '"userCode":"ABCD-1234"');
  text = text.replace(/"serverName":"[^"]*"/g, '"serverName":"runner"');
  text = text.replace(/"emittedAtMs":\d+/g, '"emittedAtMs":1700000000000');
  return `${text}\n`;
}

const out = new URL("../fixtures/recorded/", import.meta.url).pathname;

async function scenario(name: string, run: (ctx: RunnerContext, home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "rgo-codex-rec-"));
  const steps: Step[] = [];
  try {
    await run(recordingContext(home, steps), home);
    await Bun.write(join(out, `${name}.jsonl`), scrub(steps, home));
    console.log(`recorded ${name}: ${steps.length} messages`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const adapter = new CodexAdapter();

await scenario("handshake-logged-out", async (ctx) => {
  const proc = await ctx.runner.spawnPiped(
    adapter.buildSpawn(
      { agentId: "rec", provider: "codex", workdir: ctx.home, credential: { kind: "cli_login" } },
      ctx,
    ),
  );
  const client = new CodexRpcClient(proc);
  await client.initialize();
  await client.request("account/read", { refreshToken: false });
  await client.close();
});

await scenario("usage-logged-out", async (ctx) => {
  for await (const _ of adapter.readUsage(ctx)) {
    // logged out: no samples
  }
});

await scenario("device-login-cancel", async (ctx) => {
  const plan = adapter.loginFlow(ctx);
  if (plan.kind !== "device_code") throw new Error("expected device_code");
  const login = await plan.begin();
  await login.cancel();
  await login.completion;
});
