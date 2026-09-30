import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageSample } from "@regulus/protocol";
import { createFakeRunnerContext, createFakeRunnerOps } from "../testing/fake-runner-context.ts";
import { localSpawnPiped } from "../testing/local-piped.ts";
import type { PipedProcess, SpawnPlan } from "../types.ts";
import { transcriptRoot } from "./transcript.ts";
import { TranscriptScanner, transcriptScanPlan } from "./transcript-scan.ts";

function line(id: string, req: string, at: string, input: number, extra: object = {}): string {
  return `${JSON.stringify({
    type: "assistant",
    requestId: req,
    timestamp: at,
    sessionId: "s-main",
    message: {
      id,
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: 'a "usage" mention' }],
      usage: { input_tokens: input, output_tokens: 1 },
    },
    ...extra,
  })}\n`;
}

let home: string;
let piped: SpawnPlan[];

function context() {
  const runner = createFakeRunnerOps(localSpawnPiped);
  piped = runner.piped;
  return createFakeRunnerContext({ runner, home, userId: "u 1" });
}

async function collect(it: AsyncIterable<UsageSample>): Promise<UsageSample[]> {
  const out: UsageSample[] = [];
  for await (const s of it) out.push(s);
  return out;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "rg40-scan-"));
  await mkdir(join(transcriptRoot(home), "-srv-proj", "s-main", "subagents"), { recursive: true });
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("transcript scan in the runner", () => {
  test("reads only new usage lines, dedupes streamed duplicates, keeps offsets per human", async () => {
    const file = join(transcriptRoot(home), "-srv-proj", "s-main.jsonl");
    await writeFile(
      file,
      `{"type":"user","timestamp":"2026-09-30T08:00:00Z","message":{"content":"hi"}}\n${line("m1", "r1", "2026-09-30T08:00:01Z", 10)}${line("m1", "r1", "2026-09-30T08:00:01Z", 10)}`,
    );
    const scanner = new TranscriptScanner();
    const ctx = context();
    const first = await collect(scanner.scan(ctx));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ inputTokens: 10, dedupeKey: "m1:r1", sessionId: "s-main" });

    // Nothing new: nothing yielded. Then an append: only the new line.
    expect(await collect(scanner.scan(ctx))).toEqual([]);
    await appendFile(file, line("m2", "r2", "2026-09-30T08:01:00Z", 20));
    const third = await collect(scanner.scan(ctx));
    expect(third.map((s) => s.inputTokens)).toEqual([20]);
    // The offsets went to the runner in a 0600 file under ~/.regulus-office, not on argv.
    const plan = piped.at(-1) as SpawnPlan;
    expect(plan.files[0]?.path).toBe(`${home}/.regulus-office/usage/claude-transcripts.tsv`);
    expect(plan.files[0]?.mode).toBe(0o600);
    expect(String(plan.files[0]?.contents)).toContain(file);
    expect(plan.argv.join(" ")).not.toContain(file);
  });

  test("a line still being written waits for the next scan", async () => {
    const file = join(transcriptRoot(home), "-srv-proj", "s-main.jsonl");
    const whole = line("m1", "r1", "2026-09-30T08:00:01Z", 5);
    await writeFile(file, whole.slice(0, 40));
    const scanner = new TranscriptScanner();
    const ctx = context();
    expect(await collect(scanner.scan(ctx))).toEqual([]);
    await writeFile(file, whole);
    expect((await collect(scanner.scan(ctx))).map((s) => s.inputTokens)).toEqual([5]);
  });

  test("subagent transcripts count, a rewritten file is read again, since filters", async () => {
    const sub = join(transcriptRoot(home), "-srv-proj", "s-main", "subagents", "agent-1.jsonl");
    await writeFile(sub, line("m9", "r9", "2026-09-30T09:00:00Z", 7, { isSidechain: true }));
    const scanner = new TranscriptScanner();
    const ctx = context();
    expect((await collect(scanner.scan(ctx)))[0]).toMatchObject({
      inputTokens: 7,
      sessionId: "s-main",
    });
    // Shorter than what was read: the file was rewritten, so it is read from the start.
    await writeFile(sub, line("m8", "r8", "2026-09-30T07:00:00Z", 3));
    expect((await collect(scanner.scan(ctx))).map((s) => s.inputTokens)).toEqual([3]);
    const since = Date.parse("2026-09-30T08:00:00Z");
    expect(await collect(new TranscriptScanner().scan(ctx, { since }))).toEqual([]);
  });

  test("never opens anything outside ~/.claude/projects", async () => {
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(
      join(home, ".claude", ".credentials.json"),
      line("secret", "x", "2026-09-30T08:00:00Z", 99),
    );
    await writeFile(
      join(home, ".claude", "stray.jsonl"),
      line("stray", "x", "2026-09-30T08:00:00Z", 99),
    );
    expect(await collect(new TranscriptScanner().scan(context()))).toEqual([]);
  });

  test("no transcript root: an empty scan", async () => {
    await rm(join(home, ".claude"), { recursive: true, force: true });
    expect(await collect(new TranscriptScanner().scan(context()))).toEqual([]);
  });

  test("a failed scan does not move the offsets", async () => {
    const file = join(transcriptRoot(home), "-srv-proj", "s-main.jsonl");
    await writeFile(file, line("m1", "r1", "2026-09-30T08:00:01Z", 10));
    const scanner = new TranscriptScanner();
    const failing = createFakeRunnerOps(async (plan) => {
      const proc = await localSpawnPiped(plan);
      return { ...proc, exited: proc.exited.then(() => 1) } satisfies PipedProcess;
    });
    const ctx = createFakeRunnerContext({ runner: failing, home });
    expect(await collect(scanner.scan(ctx))).toHaveLength(1);
    expect(await collect(scanner.scan(ctx))).toHaveLength(1);
  });

  test("the plan runs as a side process with a sanitised id and no secrets", () => {
    const plan = transcriptScanPlan(context(), new Map());
    expect(plan.agentId).toBe("claude-usage-u_1");
    expect(Object.keys(plan.env.reveal()).sort()).toEqual(["HOME", "LC_ALL"]);
  });
});
