/**
 * The fake `claude` scripts (testing/fake-claude.sh and tests/e2e/runner/claude) run hooks through
 * tests/e2e/runner/claude-hooks.sh. It must refuse http hooks to private and link-local addresses
 * the way Claude Code does, so a settings file that real Claude Code would block fails our tests
 * too (#162), and it must run command hooks with the payload on stdin and relay their stdout.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HELPER = resolve(import.meta.dir, "../../../../../tests/e2e/runner/claude-hooks.sh");

async function sh(script: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["sh", "-c", `. '${HELPER}'\n${script}`], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

describe("claude-hooks.sh address rule (Claude Code's http hook guard)", () => {
  test.each([
    ["172.20.0.2", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["10.1.2.3", true],
    ["192.168.1.6", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["127.0.0.1", false],
    ["127.1.2.3", false],
    ["8.8.8.8", false],
    ["::1", false],
    ["::", true],
    ["fd00::1", true],
    ["fe80::1", true],
    ["::ffff:10.0.0.1", true],
    ["2001:db8::1", false],
  ])("%s blocked=%p", async (ip, blocked) => {
    const res = await sh(`claude_hook_ip_blocked '${ip}' && echo blocked || echo allowed`);
    expect(res.out.trim()).toBe(blocked ? "blocked" : "allowed");
  });
});

describe.skipIf(!Bun.which("curl") || !Bun.which("getent"))("claude-hooks.sh hooks", () => {
  let dir: string;
  let hits = 0;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rgo-fake-hooks-"));
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        hits++;
        return Response.json({ ok: true });
      },
    });
  });

  afterAll(async () => {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  });

  async function settings(handler: Record<string, unknown>): Promise<string> {
    const file = join(dir, `settings-${Math.random().toString(36).slice(2)}.json`);
    const body = { hooks: { Stop: [{ hooks: [handler] }] } };
    await writeFile(file, `${JSON.stringify(body, null, 2)}\n`);
    return file;
  }

  const run = (file: string) =>
    sh(
      `claude_hooks_error() { echo "ERROR $*"; }\nclaude_hooks_init '${file}'\nclaude_hook Stop '{"hook_event_name":"Stop"}'`,
    );

  test("an http hook to a private address is refused with Claude Code's message", async () => {
    hits = 0;
    const file = await settings({
      type: "http",
      url: `http://172.20.0.2:${server.port}/api/agents/a1/hooks/claude`,
      headers: { Authorization: "Bearer secret-token" },
    });
    const res = await run(file);
    expect(res.out).toContain(
      "ERROR Stop hook error: HTTP hook blocked: 172.20.0.2 resolves to 172.20.0.2 (private/link-local address).",
    );
    expect(hits).toBe(0);
  });

  test("an http hook to loopback is sent and its body relayed", async () => {
    hits = 0;
    const url = `http://127.0.0.1:${server.port}/x`;
    const res = await run(await settings({ type: "http", url, timeout: 5 }));
    expect(res.out).toBe('{"ok":true}');
    expect(hits).toBe(1);
  });

  test("a command hook gets the payload on stdin; its stdout is the output", async () => {
    const res = await run(
      await settings({ type: "command", command: "cat; echo ' seen'", timeout: 5 }),
    );
    expect(res.out).toBe('{"hook_event_name":"Stop"} seen');
  });

  test("a failing command hook is reported like Claude Code's non-blocking error", async () => {
    const res = await run(await settings({ type: "command", command: "exit 3", timeout: 5 }));
    expect(res.out).toBe("ERROR Stop hook error: exit 3\n");
  });
});
