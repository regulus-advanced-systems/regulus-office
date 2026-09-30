/**
 * Claude Code's first-run state (#158): the onboarding step runs its script
 * for real (bun on PATH, a temporary HOME), never a real `claude` or HOME.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFakeRunnerContext, createFakeRunnerOps } from "../testing/fake-runner-context.ts";
import type { PipedProcess, RunnerContext, SpawnPlan } from "../types.ts";
import { ClaudeCodeAdapter } from "./adapter.ts";
import {
  ensureClaudeOnboarding,
  ONBOARDING_SCRIPT,
  ONBOARDING_TRUST_ENV,
  onboardingPlan,
  trustDirs,
} from "./onboarding.ts";

const BUN_DIR = dirname(process.execPath);
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

/** Runs a plan as a local process, like LocalTmuxRunner.spawnPiped. */
function localSpawn(path: string) {
  return async (plan: SpawnPlan): Promise<PipedProcess> => {
    const proc = Bun.spawn([...plan.argv], {
      cwd: plan.cwd,
      env: { PATH: path, ...plan.env.reveal() },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      pid: proc.pid,
      stdout: proc.stdout,
      stderr: proc.stderr,
      exited: proc.exited.then((code) => (proc.signalCode ? null : code)),
      async write() {},
      kill: (signal) => proc.kill(signal),
    };
  };
}

let home: string;
let ctx: RunnerContext;
const config = () => join(home, ".claude.json");
const readConfig = () => JSON.parse(readFileSync(config(), "utf8"));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rg158-home-"));
  const runner = createFakeRunnerOps(localSpawn(`${BUN_DIR}:/usr/bin:/bin`));
  ctx = createFakeRunnerContext({ runner, home });
});
afterEach(() => {
  try {
    chmodSync(join(home, ".claude"), 0o700);
  } catch {}
  rmSync(home, { recursive: true, force: true });
});

describe("ensureClaudeOnboarding", () => {
  test("a fresh HOME gets hasCompletedOnboarding only (0600), nothing else", async () => {
    const result = await ensureClaudeOnboarding(ctx);
    expect(result).toEqual({ outcome: "changed", trusted: 0 });
    expect(readConfig()).toEqual({ hasCompletedOnboarding: true });
    expect(statSync(config()).mode & 0o777).toBe(0o600);
    // No temp file left behind.
    expect(readdirSync(home)).toEqual([".claude.json"]);
  });

  test("after `claude auth login`: every other key is kept, mode kept, second run unchanged", async () => {
    const before = {
      numStartups: 3,
      oauthAccount: { accountUuid: "fake-uuid", emailAddress: "fake@example.invalid" },
      theme: "light",
      projects: { "/other": { allowedTools: ["Bash"], hasTrustDialogAccepted: false } },
    };
    writeFileSync(config(), JSON.stringify(before), { mode: 0o640 });
    chmodSync(config(), 0o640);
    expect((await ensureClaudeOnboarding(ctx)).outcome).toBe("changed");
    expect(readConfig()).toEqual({ ...before, hasCompletedOnboarding: true });
    expect(statSync(config()).mode & 0o777).toBe(0o640);
    const written = readFileSync(config(), "utf8");
    expect((await ensureClaudeOnboarding(ctx)).outcome).toBe("unchanged");
    expect(readFileSync(config(), "utf8")).toBe(written);
  });

  test("trust is written only for the given worktree, never other folders", async () => {
    writeFileSync(
      config(),
      JSON.stringify({ projects: { "/srv/wt/a1": { allowedTools: ["Read"] }, "/clone": {} } }),
    );
    const result = await ensureClaudeOnboarding(ctx, { trust: ["/srv/wt/a1/"] });
    expect(result).toEqual({ outcome: "changed", trusted: 1 });
    const cfg = readConfig();
    expect(cfg.projects["/srv/wt/a1"]).toEqual({
      allowedTools: ["Read"],
      hasTrustDialogAccepted: true,
    });
    expect(cfg.projects["/clone"]).toEqual({});
    expect(Object.keys(cfg.projects)).toEqual(["/srv/wt/a1", "/clone"]);
  });

  test("CLAUDE_CONFIG_DIR is honoured like the CLI does", async () => {
    const dir = join(home, "cfg");
    mkdirSync(dir);
    const plan = onboardingPlan(ctx);
    const proc = await localSpawn(`${BUN_DIR}:/usr/bin:/bin`)({
      ...plan,
      env: plan.env.with("CLAUDE_CONFIG_DIR", dir),
    });
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"))).toEqual({
      hasCompletedOnboarding: true,
    });
  });

  test("an unparsable or non-object config is left alone", async () => {
    writeFileSync(config(), "{ not json");
    expect((await ensureClaudeOnboarding(ctx)).outcome).toBe("bad_config");
    expect(readFileSync(config(), "utf8")).toBe("{ not json");
    writeFileSync(config(), "[1,2]");
    expect((await ensureClaudeOnboarding(ctx)).outcome).toBe("bad_config");
    expect(readFileSync(config(), "utf8")).toBe("[1,2]");
  });

  test("a .claude.json symlink to any other file is refused", async () => {
    mkdirSync(join(home, ".claude"));
    const secret = join(home, ".claude", ".credentials.json");
    writeFileSync(secret, '{"claudeAiOauth":"FAKE-SECRET"}', { mode: 0o600 });
    symlinkSync(secret, config());
    expect((await ensureClaudeOnboarding(ctx)).outcome).toBe("failed");
    expect(readFileSync(secret, "utf8")).toBe('{"claudeAiOauth":"FAKE-SECRET"}');
    expect(lstatSync(config()).isSymbolicLink()).toBe(true);
  });

  test.skipIf(isRoot)(
    "~/.claude/ is never needed: it works with that folder unreadable",
    async () => {
      mkdirSync(join(home, ".claude"));
      const secret = join(home, ".claude", ".credentials.json");
      writeFileSync(secret, '{"claudeAiOauth":"FAKE-SECRET"}', { mode: 0o600 });
      const before = statSync(secret);
      chmodSync(join(home, ".claude"), 0o000);
      expect((await ensureClaudeOnboarding(ctx, { trust: ["/w"] })).outcome).toBe("changed");
      chmodSync(join(home, ".claude"), 0o700);
      const after = statSync(secret);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(readFileSync(secret, "utf8")).toBe('{"claudeAiOauth":"FAKE-SECRET"}');
    },
  );

  test("the script prints one word, never the config", async () => {
    writeFileSync(config(), JSON.stringify({ oauthAccount: { emailAddress: "fake@x.invalid" } }));
    const proc = await localSpawn(`${BUN_DIR}:/usr/bin:/bin`)(onboardingPlan(ctx, ["/w"]));
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(0);
    expect(out).toBe("changed\n");
    expect(err).toBe("");
  });

  test("no node or bun in the runner: no_runtime, nothing written", async () => {
    const bin = join(home, "bin");
    mkdirSync(bin);
    symlinkSync("/bin/sh", join(bin, "sh"));
    const runner = createFakeRunnerOps(localSpawn(bin));
    const bare = createFakeRunnerContext({ runner, home });
    expect((await ensureClaudeOnboarding(bare)).outcome).toBe("no_runtime");
    expect(readdirSync(home)).toEqual(["bin"]);
  });

  test("never throws: a runner that cannot spawn only fails the step", async () => {
    const failing = createFakeRunnerContext({ home, runner: createFakeRunnerOps() });
    expect(await ensureClaudeOnboarding(failing)).toEqual({ outcome: "failed", trusted: 0 });
  });
});

describe("the onboarding plan (SPEC §8)", () => {
  test("only a side process: no files, no secrets, no credential paths", () => {
    const runner = createFakeRunnerOps();
    const plan = onboardingPlan(createFakeRunnerContext({ runner }), ["/srv/wt/a1"]);
    expect(plan.files).toEqual([]);
    expect(plan.env.names().sort()).toEqual(
      ["DISABLE_AUTOUPDATER", "HOME", ONBOARDING_TRUST_ENV].sort(),
    );
    expect(plan.env.reveal()[ONBOARDING_TRUST_ENV]).toBe('["/srv/wt/a1"]');
    const text = `${plan.argv.join(" ")} ${JSON.stringify(plan.env.reveal())}`;
    expect(text).not.toMatch(/credentials|\.claude\/|oauth|token|apiKey/i);
    expect(ONBOARDING_SCRIPT).toContain('".claude.json"');
    // Only these keys are ever set.
    const assigned = [...ONBOARDING_SCRIPT.matchAll(/\.(\w+) = true/g)].map((m) => m[1]);
    expect(new Set(assigned)).toEqual(
      new Set(["hasCompletedOnboarding", "hasTrustDialogAccepted"]),
    );
  });

  test("trustDirs keeps absolute single-line paths only", () => {
    expect(trustDirs(["/a/b/", "/a/b", "rel", "/", "/x/../y", "/n\nl", undefined, ""])).toEqual([
      "/a/b",
    ]);
  });
});

describe("ClaudeCodeAdapter.prepareSpawn", () => {
  const plan = { agentId: "a1" } as SpawnPlan;

  test("trusts the robot's worktree by default; nothing without one", async () => {
    const adapter = new ClaudeCodeAdapter();
    expect(await adapter.prepareSpawn(plan, ctx, { worktree: "/srv/wt/a1" })).toEqual({
      outcome: "changed",
      trusted: 1,
    });
    expect(Object.keys(readConfig().projects)).toEqual(["/srv/wt/a1"]);
    rmSync(config());
    expect(await adapter.prepareSpawn(plan, ctx, {})).toEqual({ outcome: "changed", trusted: 0 });
    expect(readConfig()).toEqual({ hasCompletedOnboarding: true });
  });

  test("trustWorktrees: false marks onboarding only", async () => {
    const adapter = new ClaudeCodeAdapter({ trustWorktrees: false });
    await adapter.prepareSpawn(plan, ctx, { worktree: "/srv/wt/a1" });
    expect(readConfig()).toEqual({ hasCompletedOnboarding: true });
  });
});
