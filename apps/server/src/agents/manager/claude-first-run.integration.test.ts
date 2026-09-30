/**
 * #158: a Claude Code robot goes straight to idle after its human signed in,
 * because the office marks Claude's onboarding complete and trusts the
 * robot's own worktree (only that folder) before the spawn; when a first-run
 * screen still shows, the robot waits for its human with a fixed reason.
 *
 * Real AgentManager + GitWorktreeWorkspaces + LocalTmuxRunner + hook route,
 * with a fake `claude` that shows the onboarding / trust screens unless the
 * flags are set (hooks/testing/fake-claude-first-run.sh). No real CLI, no
 * real HOME. Skipped without tmux or curl.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_SIGN_IN_REASON,
  CLAUDE_TRUST_REASON,
  ClaudeCodeAdapter,
} from "@regulus/agent-adapters";
import { eq } from "drizzle-orm";
import { agents } from "../../db/schema/index.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { hasTmux, LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { setupFloor } from "../../worktrees/test-helpers.ts";
import { mountClaudeHookRoutes } from "../hooks/routes.ts";
import { makeManager } from "./test-helpers.ts";

const FAKE_CLAUDE = join(import.meta.dir, "../hooks/testing/fake-claude-first-run.sh");

describe.skipIf(!hasTmux() || !Bun.which("curl"))("Claude first run (#158)", () => {
  let root: string;
  let dist: string;
  let runner: LocalTmuxRunner;
  let server: OfficeServer;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rg158-first-run-"));
    dist = join(root, "no-dist");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  afterEach(async () => {
    await server?.stop(true);
    await runner?.dispose();
  });

  async function office(adapterOpts: ConstructorParameters<typeof ClaudeCodeAdapter>[0] = {}) {
    const f = await setupFloor(root);
    runner = await LocalTmuxRunner.create();
    server = createOfficeServer({
      config: { port: 0, host: "127.0.0.1", webDist: dist },
      logger: createLogger({ level: "silent" }),
      version: "test",
    });
    const adapter = new ClaudeCodeAdapter({
      command: FAKE_CLAUDE,
      screenPollMs: 50,
      ...adapterOpts,
    });
    const { manager, robots } = makeManager(f.db, runner, [adapter], {
      officeUrl: `http://127.0.0.1:${server.port}`,
      workspaces: f.worktrees.workspaces,
      clones: f.worktrees.workspaces,
    });
    mountClaudeHookRoutes(server.router, {
      sink: manager,
      tokens: manager.tokens,
      adapter,
      contextFor: (id) => manager.contextFor(id),
    });
    const home = (await runner.provision({ userId: f.owner.id })).home;
    const spawn = (taskTitle: string) =>
      manager.spawn(f.owner, {
        floorId: f.floorId,
        repoId: f.repo.repoId,
        provider: "claude-code",
        model: "sonnet",
        prompt: "hello",
        taskTitle,
        autoWorktree: true,
      });
    const workdirOf = (id: string) =>
      f.db.select().from(agents).where(eq(agents.id, id)).get()?.workdir ?? "";
    return { f, robots, home, spawn, workdirOf };
  }

  test("after `claude auth login` (no onboarding flag), the robot goes straight to idle", async () => {
    const o = await office();
    // What `claude auth login` leaves: the account, no onboarding flag. And the credentials
    // file, which the office must never touch.
    await writeFile(
      join(o.home, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: "fake" }, numStartups: 1 }),
      { mode: 0o600 },
    );
    await mkdir(join(o.home, ".claude"), { mode: 0o700 });
    const secret = join(o.home, ".claude", ".credentials.json");
    await writeFile(secret, '{"claudeAiOauth":"FAKE-NOT-A-TOKEN"}', { mode: 0o600 });
    const secretBefore = await stat(secret);

    const { agentId } = await o.spawn("First robot");
    const robot = await o.robots.waitFor(agentId, (r) => r.status === "idle", 15_000);
    expect(robot.statusReason).toBe("");
    expect(o.robots.history.some((r) => r.status === "waiting_input")).toBe(false);

    const cfg = JSON.parse(await readFile(join(o.home, ".claude.json"), "utf8"));
    const worktree = o.workdirOf(agentId);
    expect(worktree).toBe(join(o.f.areaOf(), agentId));
    expect(cfg).toEqual({
      oauthAccount: { accountUuid: "fake" },
      numStartups: 1,
      hasCompletedOnboarding: true,
      // Only the robot's own worktree; never the human's clone.
      projects: { [worktree]: { hasTrustDialogAccepted: true } },
    });
    expect(Object.keys(cfg.projects)).not.toContain(o.f.cloneOf());
    const secretAfter = await stat(secret);
    expect(secretAfter.mtimeMs).toBe(secretBefore.mtimeMs);
    expect(await readFile(secret, "utf8")).toBe('{"claudeAiOauth":"FAKE-NOT-A-TOKEN"}');
  }, 30_000);

  test("OFFICE_CLAUDE_TRUST_WORKTREES off: the trust dialog makes the robot wait for its human", async () => {
    const o = await office({ trustWorktrees: false });
    const { agentId } = await o.spawn("Untrusted");
    const robot = await o.robots.waitFor(agentId, (r) => r.status === "waiting_input", 15_000);
    expect(robot).toMatchObject({ handRaised: true, statusReason: CLAUDE_TRUST_REASON });
    const cfg = JSON.parse(await readFile(join(o.home, ".claude.json"), "utf8"));
    expect(cfg).toEqual({ hasCompletedOnboarding: true });
  }, 30_000);

  test("onboarding still showing (config unusable): waiting_input, sign in via the terminal", async () => {
    const o = await office();
    // A config the office will not rewrite (not JSON): Claude shows its first-run screens.
    await writeFile(join(o.home, ".claude.json"), "{ broken", { mode: 0o600 });
    const { agentId } = await o.spawn("Needs sign-in");
    const robot = await o.robots.waitFor(agentId, (r) => r.status === "waiting_input", 15_000);
    expect(robot).toMatchObject({ handRaised: true, statusReason: CLAUDE_SIGN_IN_REASON });
    expect(await readFile(join(o.home, ".claude.json"), "utf8")).toBe("{ broken");
  }, 30_000);
});
