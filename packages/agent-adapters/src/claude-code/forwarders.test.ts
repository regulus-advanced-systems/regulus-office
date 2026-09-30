import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret } from "../secret.ts";
import { createFakeRunnerContext } from "../testing/fake-runner-context.ts";
import type { PlannedFile } from "../types.ts";
import { ClaudeCodeAdapter } from "./adapter.ts";
import {
  HOOK_MAX_SECONDS,
  hookScript,
  hookUrl,
  settingsDir,
  statuslineScript,
  statuslineUrl,
} from "./forwarders.ts";
import { CLAUDE_HOOK_EVENTS } from "./hooks.ts";

const TOKEN = "hook-token-DO-NOT-LEAK";
const ctx = createFakeRunnerContext({ agentToken: Secret.of(TOKEN) });
const adapter = new ClaudeCodeAdapter({ newSessionId: () => "s-1" });

const reveal = (file: PlannedFile) =>
  typeof file.contents === "string" ? file.contents : file.contents.reveal();

function planFiles() {
  const plan = adapter.buildSpawn(
    { agentId: "a1", provider: "claude-code", workdir: "/w", credential: { kind: "cli_login" } },
    ctx,
  );
  const byName = (name: string) => plan.files.find((f) => f.path.endsWith(`/${name}`));
  return { plan, byName };
}

describe("hook settings (#162)", () => {
  test("every event is a command hook running hook.sh; no http hooks, no token", () => {
    const { byName } = planFiles();
    const file = byName("settings.json") as PlannedFile;
    expect(file.mode).toBe(0o600);
    const text = reveal(file);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('"http"');
    const settings = JSON.parse(text);
    const dir = settingsDir(ctx.home, "a1");
    expect(Object.keys(settings.hooks).sort()).toEqual([...CLAUDE_HOOK_EVENTS].sort());
    for (const event of CLAUDE_HOOK_EVENTS) {
      const max =
        event === "PermissionRequest" ? adapter.permissionHoldSeconds + 3 : HOOK_MAX_SECONDS;
      expect(settings.hooks[event]).toEqual([
        { hooks: [{ type: "command", command: `'${dir}/hook.sh' ${max}`, timeout: max + 2 }] },
      ]);
    }
    expect(settings.statusLine).toEqual({
      type: "command",
      command: `'${dir}/statusline.sh'`,
      padding: 0,
    });
  });

  test("the PermissionRequest hook outlasts the office's hold", () => {
    const settings = JSON.parse(reveal(planFiles().byName("settings.json") as PlannedFile));
    const [group] = settings.hooks.PermissionRequest;
    expect(group.hooks[0].timeout).toBeGreaterThan(adapter.permissionHoldSeconds);
  });

  test("only office.headers holds the token, as a 0600 Secret", () => {
    const { plan, byName } = planFiles();
    const headers = byName("office.headers") as PlannedFile;
    expect(headers.contents).toBeInstanceOf(Secret);
    expect(headers.mode).toBe(0o600);
    expect(reveal(headers)).toBe(`Authorization: Bearer ${TOKEN}\n`);
    for (const file of plan.files) {
      if (file !== headers) expect(reveal(file)).not.toContain(TOKEN);
    }
    expect(plan.argv.join(" ")).not.toContain(TOKEN);
    for (const name of ["hook.sh", "statusline.sh"]) expect(byName(name)?.mode).toBe(0o700);
    expect(reveal(byName("hook.sh") as PlannedFile)).toContain(hookUrl(ctx.officeUrl, "a1"));
    expect(hookUrl(ctx.officeUrl, "a1")).toBe("http://office.test/api/agents/a1/hooks/claude");
  });
});

interface Received {
  auth: string | null;
  body: unknown;
}

describe.skipIf(!Bun.which("curl"))("forwarder scripts", () => {
  let dir: string;
  let received: Received[] = [];
  let reply: () => Response | Promise<Response> = () => new Response(null, { status: 204 });
  let server: ReturnType<typeof Bun.serve>;
  const argvLog = () => join(dir, "curl-argv.log");

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rgo-forwarders-"));
    await writeFile(join(dir, "office.headers"), `Authorization: Bearer ${TOKEN}\n`, {
      mode: 0o600,
    });
    // A curl on PATH that records its argv, to prove the token is never on it.
    await writeFile(
      join(dir, "curl"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(argvLog())}\nexec ${Bun.which("curl")} "$@"\n`,
      { mode: 0o700 },
    );
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 30,
      async fetch(req) {
        received.push({ auth: req.headers.get("authorization"), body: await req.json() });
        return reply();
      },
    });
  });

  afterAll(async () => {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  });

  async function run(name: string, contents: string, input: unknown, args: string[] = []) {
    const script = join(dir, name);
    await writeFile(script, contents, { mode: 0o700 });
    const proc = Bun.spawn(["sh", script, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: `${dir}:${process.env.PATH ?? "/usr/bin:/bin"}` },
    });
    proc.stdin.write(JSON.stringify(input));
    await proc.stdin.end();
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const argv = await readFile(argvLog(), "utf8").catch(() => "");
    return { code, out, err, argv };
  }

  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  const hook = (input: unknown, args?: string[], target = url("/api/agents/a1/hooks/claude")) =>
    run("hook.sh", hookScript("a1", target), input, args);

  test("hook.sh POSTs stdin with the bearer header and relays the decision body", async () => {
    received = [];
    const decision = {
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    };
    reply = () => Response.json(decision);
    const input = { hook_event_name: "PermissionRequest", tool_name: "Edit", session_id: "s-1" };
    const res = await hook(input, ["30"]);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out)).toEqual(decision);
    expect(received).toEqual([{ auth: `Bearer ${TOKEN}`, body: input }]);
    expect(`${res.out}${res.err}${res.argv}`).not.toContain(TOKEN);
    expect(res.argv).toContain("@");
    expect(res.argv).toContain("--max-time 30");
  });

  test("hook.sh prints nothing for a 204 and for an error status", async () => {
    reply = () => new Response(null, { status: 204 });
    expect((await hook({ hook_event_name: "Stop" })).out).toBe("");
    reply = () => Response.json({ error: "unauthorized" }, { status: 401 });
    const res = await hook({ hook_event_name: "Stop" });
    expect(res).toMatchObject({ code: 0, out: "" });
    expect(res.err).not.toContain(TOKEN);
  });

  test("hook.sh exits 0 silently when the office is unreachable or too slow", async () => {
    const down = await hook({ hook_event_name: "SessionStart" }, [], "http://127.0.0.1:1/x");
    expect(down).toMatchObject({ code: 0, out: "", err: "" });
    reply = () => Bun.sleep(4000).then(() => Response.json({ late: true }));
    const started = Date.now();
    const slow = await hook({ hook_event_name: "PermissionRequest" }, ["1"]);
    expect(slow).toMatchObject({ code: 0, out: "" });
    expect(Date.now() - started).toBeLessThan(3500);
    reply = () => new Response(null, { status: 204 });
  });

  test("hook.sh exits 0 without the headers file and never leaves response files", async () => {
    const bare = await mkdtemp(join(tmpdir(), "rgo-forwarders-bare-"));
    try {
      const script = join(bare, "hook.sh");
      await writeFile(script, hookScript("a1", url("/x")), { mode: 0o700 });
      const proc = Bun.spawn(["sh", script], { stdin: "pipe", stdout: "pipe" });
      proc.stdin.write("{}");
      await proc.stdin.end();
      expect(await proc.exited).toBe(0);
      expect(await new Response(proc.stdout).text()).toBe("");
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
    const leftovers = [...new Bun.Glob(".hook-response.*").scanSync({ cwd: dir, dot: true })];
    expect(leftovers).toEqual([]);
  });

  test("statusline.sh POSTs the JSON and prints only a status line", async () => {
    received = [];
    reply = () => new Response(null, { status: 204 });
    const input = { session_id: "s1", model: { display_name: "Opus" } };
    const res = await run("statusline.sh", statuslineScript("a1", url("/sl")), input);
    expect(res).toMatchObject({ code: 0, out: "Regulus Office | Opus\n" });
    expect(`${res.out}${res.err}${res.argv}`).not.toContain(TOKEN);
    expect(received).toEqual([{ auth: `Bearer ${TOKEN}`, body: input }]);
    expect(statuslineUrl("http://o/", "a1")).toBe("http://o/api/agents/a1/statusline");
  });

  test("an unreachable office does not fail the statusline", async () => {
    const input = { model: { display_name: "Opus" } };
    const res = await run("statusline.sh", statuslineScript("a1", "http://127.0.0.1:1/x"), input);
    expect(res).toMatchObject({ code: 0, out: "Regulus Office | Opus\n" });
  });
});
