/**
 * Blocking-screen detection (#158): pane text as Claude Code v2.1.285 draws
 * it (captured with an empty temporary HOME, no account), and the control's
 * watch that turns such a screen into `waiting_input` until the first hook.
 */
import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@regulus/protocol";
import { Secret } from "../secret.ts";
import { createFakeRunnerContext, createFakeRunnerOps } from "../testing/fake-runner-context.ts";
import { ClaudeCodeAdapter } from "./adapter.ts";
import {
  CLAUDE_SIGN_IN_REASON,
  CLAUDE_TRUST_REASON,
  detectBlockingScreen,
  HUMAN_WAIT_REASONS,
} from "./sign-in-screen.ts";

const THEME_PICKER = `Welcome to Claude Code v2.1.285
 Let's get started.
 Choose the text style that looks best with your terminal
 To change this later, run /theme
   1. Auto (match terminal)
 ❯ 2. Dark mode ✔`;

const LOGIN_METHOD = ` Select login method:
 ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise
   2. Anthropic Console account · API usage billing`;

const OAUTH = ` Browser didn't open? Use the url below to sign in (c to copy)
https://claude.ai/oauth/authorize?code=true&client_id=fake&response_type=code
 Paste code here if prompted >`;

const NOT_LOGGED_IN = `❯
  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents          Not logged in · Run /login`;

const TRUST = ` Accessing workspace:
 /srv/office/worktrees/f/r/a1
 Quick safety check: Is this a project you created or one you trust? (Like your own code, a
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel`;

const WORKING = `❯ fix the bug
● Reading src/app.ts
  ⏵⏵ auto mode on (shift+tab to cycle)`;

describe("detectBlockingScreen", () => {
  test("first-run onboarding and login screens are sign-in", () => {
    for (const pane of [THEME_PICKER, LOGIN_METHOD, OAUTH, NOT_LOGGED_IN]) {
      expect(detectBlockingScreen(pane)).toBe("sign_in");
    }
  });

  test("the workspace trust dialog is trust; a working session is nothing", () => {
    expect(detectBlockingScreen(TRUST)).toBe("trust");
    expect(detectBlockingScreen(WORKING)).toBeNull();
    expect(detectBlockingScreen("")).toBeNull();
  });

  test("tmux's blank rows below the screen do not push it out of view", () => {
    expect(detectBlockingScreen(`${TRUST}${"\n".repeat(80)}`)).toBe("trust");
  });

  test("only the last lines count", () => {
    const old = `${THEME_PICKER}\n${"\n".repeat(60)}${WORKING}`;
    expect(detectBlockingScreen(old)).toBeNull();
  });

  test("the reasons are fixed, human-facing texts", () => {
    expect(CLAUDE_SIGN_IN_REASON).toBe("Claude needs you to finish signing in: open its terminal");
    expect(HUMAN_WAIT_REASONS.has(CLAUDE_SIGN_IN_REASON)).toBe(true);
    expect(HUMAN_WAIT_REASONS.has(CLAUDE_TRUST_REASON)).toBe(true);
  });
});

function setup(opts: { screenWatchMs?: number } = {}) {
  const runner = createFakeRunnerOps();
  const ctx = createFakeRunnerContext({ runner, agentToken: Secret.of("tok") });
  const adapter = new ClaudeCodeAdapter({ screenPollMs: 10, ...opts });
  const plan = adapter.buildSpawn(
    { agentId: "a1", provider: "claude-code", workdir: "/w", credential: { kind: "cli_login" } },
    ctx,
  );
  return { runner, ctx, adapter, plan };
}

/** Every event of a control, collected in the background. */
function record(events: AsyncIterable<AgentEvent>) {
  const seen: AgentEvent[] = [];
  void (async () => {
    for await (const e of events) seen.push(e);
  })();
  const until = async (done: (e: AgentEvent[]) => boolean, ms = 3_000) => {
    const deadline = Date.now() + ms;
    while (!done(seen) && Date.now() < deadline) await Bun.sleep(10);
    return seen;
  };
  return { seen, until };
}

const waits = (events: AgentEvent[]) =>
  events.filter((e) => e.kind === "status" && e.status === "waiting_input");

describe("ClaudeControl screen watch", () => {
  test("a sign-in screen turns the robot to waiting_input with the fixed reason, once", async () => {
    const { adapter, ctx, plan, runner } = setup();
    runner.panes.set(plan.tmuxSession, THEME_PICKER);
    const control = adapter.connect(plan, ctx);
    const rec = record(control.events);
    const events = await rec.until((e) => waits(e).length > 0);
    expect(events[0]).toMatchObject({ kind: "status", status: "starting" });
    expect(waits(events)[0]).toMatchObject({ reason: CLAUDE_SIGN_IN_REASON });
    // The same screen is not reported again; the next one is.
    await Bun.sleep(60);
    expect(waits(rec.seen)).toHaveLength(1);
    runner.panes.set(plan.tmuxSession, TRUST);
    await rec.until((e) => waits(e).length > 1);
    expect(waits(rec.seen)).toHaveLength(2);
    expect(waits(rec.seen)[1]).toMatchObject({ reason: CLAUDE_TRUST_REASON });
    await control.close();
  });

  test("the pane text itself (the OAuth link) never leaves the adapter", async () => {
    const { adapter, ctx, plan, runner } = setup();
    runner.panes.set(plan.tmuxSession, OAUTH);
    const control = adapter.connect(plan, ctx);
    const events = await record(control.events).until((e) => waits(e).length > 0);
    expect(waits(events)).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("oauth/authorize");
    await control.close();
  });

  test("the first hook ends the watch", async () => {
    const { adapter, ctx, plan, runner } = setup();
    const control = adapter.connect(plan, ctx);
    adapter.ingest(
      {
        channel: "hook",
        agentId: "a1",
        payload: { hook_event_name: "SessionStart", session_id: "s1", source: "startup" },
      },
      ctx,
    );
    runner.panes.set(plan.tmuxSession, THEME_PICKER);
    const events = await record(control.events).until(() => false, 200);
    expect(events).toHaveLength(1);
    expect(waits(events)).toEqual([]);
    await control.close();
  });

  test("a re-adopted robot (nothing started) and screenPollMs: 0 are not watched", async () => {
    const { adapter, ctx, plan, runner } = setup();
    runner.panes.set(plan.tmuxSession, THEME_PICKER);
    const adopted = adapter.connect({ ...plan, argv: [] }, ctx);
    const off = new ClaudeCodeAdapter({ screenPollMs: 0 }).connect(plan, ctx);
    const a = record(adopted.events);
    const b = record(off.events);
    await Bun.sleep(150);
    expect(waits(a.seen)).toEqual([]);
    expect(waits(b.seen)).toEqual([]);
    await adopted.close();
    await off.close();
  });
});
