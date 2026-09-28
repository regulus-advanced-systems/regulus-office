import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAdapter, Secret } from "@regulus/agent-adapters";
import {
  isUnknownFlag,
  PASTE_SCRIPT,
  pasteBufferArgs,
  pasteBufferName,
  pasteMode,
} from "./keys.ts";
import { hasTmux, LocalTmuxRunner } from "./testing/local-tmux-runner.ts";
import { attachWatcher } from "./testing/watcher.ts";
import { bindRunnerOps } from "./types.ts";

describe("paste rules", () => {
  test("plain text, tabs and newlines are bracketed pastes; control keys are raw", () => {
    expect(pasteMode("hello")).toBe("text");
    expect(pasteMode("line one\nline two\r\n\tindented ✓")).toBe("text");
    expect(pasteMode("\u001b")).toBe("raw");
    expect(pasteMode("\u0003")).toBe("raw");
    expect(pasteMode("\u001b[A")).toBe("raw");
    expect(pasteMode("a\u007f")).toBe("raw");
  });

  test("buffer names are unique and tmux-safe", () => {
    const names = new Set(Array.from({ length: 100 }, pasteBufferName));
    expect(names.size).toBe(100);
    for (const n of names) expect(n).toMatch(/^office-keys-[0-9a-f]{16}$/);
  });

  test("paste-buffer flags per mode", () => {
    expect(pasteBufferArgs("b", "text", "=s:")).toEqual([
      "paste-buffer",
      "-d",
      "-p",
      "-b",
      "b",
      "-t",
      "=s:",
    ]);
    expect(pasteBufferArgs("b", "raw", "=s:")).toEqual([
      "paste-buffer",
      "-d",
      "-S",
      "-b",
      "b",
      "-t",
      "=s:",
    ]);
    expect(pasteBufferArgs("b", "raw", "=s:", true)).toEqual([
      "paste-buffer",
      "-d",
      "-b",
      "b",
      "-t",
      "=s:",
    ]);
    expect(isUnknownFlag("command paste-buffer: unknown flag -S")).toBe(true);
    expect(isUnknownFlag("can't find pane: =s:")).toBe(false);
  });
});

/** PASTE_SCRIPT (docker backend) against a real tmux with a watcher attached. */
describe.skipIf(!hasTmux())("PASTE_SCRIPT", () => {
  let runner: LocalTmuxRunner;
  let workdir: string;

  beforeEach(async () => {
    runner = await LocalTmuxRunner.create();
    workdir = await mkdtemp(join(tmpdir(), "rgo-keys-"));
  });

  afterEach(async () => {
    await runner.dispose();
    await rm(workdir, { recursive: true, force: true });
  });

  async function paste(keys: string, enter: boolean): Promise<number> {
    const bytes = new TextEncoder().encode(keys);
    const args = [runner.socket, pasteBufferName(), "=agent-k1:", `${bytes.byteLength}`];
    // Trailing stdin after <bytes> must be ignored (the Engine API exec stdin stays open).
    const proc = Bun.spawn(
      ["sh", "-c", PASTE_SCRIPT, "sh", ...args, pasteMode(keys), enter ? "1" : "0"],
      { stdin: new TextEncoder().encode(`${keys}IGNORED`), stdout: "pipe", stderr: "pipe" },
    );
    return proc.exited;
  }

  test("types text, Enter and Ctrl-C while a read-only client is attached", async () => {
    const user = { userId: "u1" };
    const handle = await runner.provision(user);
    const plan = new FakeAdapter({
      command: ["sh", join(import.meta.dir, "testing/fake-agent.sh")],
    }).buildSpawn(
      {
        agentId: "k1",
        provider: "custom",
        workdir,
        credential: { kind: "api_key", apiKey: Secret.of("k"), attributedTo: "user" },
      },
      {
        backend: runner.backend,
        userId: user.userId,
        home: handle.home,
        officeUrl: "http://office.test",
        agentToken: Secret.of("t"),
        now: Date.now,
        runner: bindRunnerOps(runner, user),
      },
    );
    const session = await runner.exec(user, plan);
    const watcher = await attachWatcher(runner, session, "FAKE AGENT READY");
    const screen = async (want: string) => {
      const deadline = Date.now() + 5000;
      for (;;) {
        const s = await runner.capturePane(session, 50);
        if (s.includes(want) || Date.now() > deadline) return s;
        await Bun.sleep(25);
      }
    };
    try {
      expect(await paste("one\ntwo", true)).toBe(0);
      expect(await screen("you said: two")).toContain("you said: one");
      expect(await paste("\u0003", false)).toBe(0);
      expect(await paste("", true)).toBe(0);
      expect(await paste("three", true)).toBe(0);
      const after = await screen("you said: three");
      expect(after).toContain("FAKE AGENT INTERRUPTED");
      expect(after).not.toContain("IGNORED");
      const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
      const buffers = await Bun.$`tmux -S ${runner.socket} list-buffers`.env(env).text();
      expect(buffers.trim()).toBe("");
      // A missing session fails and leaves no buffer behind.
      const proc = Bun.spawn(
        [
          "sh",
          "-c",
          PASTE_SCRIPT,
          "sh",
          runner.socket,
          "office-keys-x",
          "=nope:",
          "2",
          "text",
          "0",
        ],
        { stdin: new TextEncoder().encode("hi"), stdout: "pipe", stderr: "pipe" },
      );
      expect(await proc.exited).toBe(1);
      expect(await new Response(proc.stderr).text()).toContain("nope");
      expect((await Bun.$`tmux -S ${runner.socket} list-buffers`.env(env).text()).trim()).toBe("");
    } finally {
      await watcher.close();
    }
  }, 20_000);
});
