import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import { capTail, ScrollbackRecorder } from "./scrollback.ts";
import type { TerminalTarget } from "./targets.ts";

const logger = createLogger({ level: "silent" });

function fakeTarget(agentId: string, pane: { text: string; captures: number }): TerminalTarget {
  const runner = {
    capturePane: async () => {
      pane.captures += 1;
      return pane.text;
    },
  } as unknown as Runner;
  return {
    agentId,
    ownerUserId: "u1",
    floorId: "f1",
    session: { userId: "u1", name: `agent-${agentId}` },
    runner,
  };
}

describe("capTail", () => {
  test("keeps short text and cuts long text at a line boundary", () => {
    expect(capTail("a\nb\n", 100)).toBe("a\nb\n");
    expect(capTail("line-one\nline-two\nline-3\n", 12)).toBe("line-3\n");
    expect(Buffer.byteLength(capTail("é".repeat(1000), 101))).toBeLessThanOrEqual(101);
  });
});

describe("ScrollbackRecorder", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("writes private, capped snapshots and skips unchanged panes", async () => {
    dir = await mkdtemp(join(tmpdir(), "rgo-scrollback-"));
    const snapshots = join(dir, "terminals", "scrollback");
    const recorder = new ScrollbackRecorder({
      dir: snapshots,
      logger,
      maxBytes: 64,
      intervalMs: 60_000,
    });
    const pane = { text: `${"x".repeat(80)}\nhello\nworld\n`, captures: 0 };
    const release = recorder.track(fakeTarget("a1", pane));
    await recorder.flush();
    const file = recorder.pathFor("a1");
    expect(await Bun.file(file).text()).toBe("hello\nworld\n");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(snapshots)).mode & 0o777).toBe(0o700);
    const before = (await stat(file)).mtimeMs;
    await Bun.sleep(5);
    await recorder.flush();
    expect((await stat(file)).mtimeMs).toBe(before);
    expect(pane.captures).toBe(2);
    pane.text = "changed\n";
    release();
    await Bun.sleep(20);
    expect(recorder.trackedCount).toBe(0);
    expect(await Bun.file(file).text()).toBe("changed\n");
    await recorder.stop();
  });

  test("snapshots on its interval while tracked, refcounted per agent", async () => {
    dir = await mkdtemp(join(tmpdir(), "rgo-scrollback-"));
    const recorder = new ScrollbackRecorder({ dir, logger, intervalMs: 20 });
    const pane = { text: "tick\n", captures: 0 };
    const target = fakeTarget("a2", pane);
    const r1 = recorder.track(target);
    const r2 = recorder.track(target);
    await Bun.sleep(70);
    expect(pane.captures).toBeGreaterThanOrEqual(2);
    r1();
    r1();
    expect(recorder.trackedCount).toBe(1);
    r2();
    expect(recorder.trackedCount).toBe(0);
    await recorder.stop();
    expect(() => recorder.pathFor("../etc/passwd")).toThrow();
  });
});
