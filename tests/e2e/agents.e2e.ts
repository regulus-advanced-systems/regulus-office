/**
 * M1 exit criteria, automated half (docs/SPEC.md §10 M1, issue #120): an owner spawns a
 * Claude Code robot at a desk on a floor cloned from a (local, file://) repo; the robot
 * animates by action and raises its hand; the permission prompt reaches the owner but not a
 * second member's browser; approving lets the agent commit; the one-click PR reaches a fake
 * GitHub with `Closes #n`; restarting office-server re-adopts the same tmux session, whose
 * terminal still opens; sending the robot home frees the desk and deletes the branch as chosen.
 *
 * The agent is the fake `claude` in tests/e2e/runner (never the real CLI, no account, no
 * network beyond the office's hook URL), run by the production `docker` runner backend in a
 * small test runner image. The spec starts, restarts and stops its own office-server in
 * production mode (tests/e2e/agentOffice.ts). Run with `bun run e2e:agents`; needs Docker.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  AgentOffice,
  buildRunnerImage,
  cleanupRunners,
  dockerAvailable,
  sh,
} from "./agentOffice.ts";
import { collectTerminalOutput, history, recordRobots, robots, scenePoint } from "./agentProbes.ts";
import { type FakeGitHub, startFakeGitHub } from "./fakeGitHub.ts";
import { createRemoteRepo } from "./gitRemote.ts";
import { freeDeskPoint, OFFICE_PROBE_PATH, waitForScene } from "./probes.ts";

const run = Date.now().toString(36);
const owner = { name: "Ada Owner", email: `owner-${run}@example.com`, password: `owner-pw-${run}` };
const member = {
  name: "Ben Member",
  email: `member-${run}@example.com`,
  password: `member-pw-${run}`,
};
const REPO = { owner: "octo", name: "robots", branch: "trunk" };
const FLOOR = "Hangar";
const ISSUE = 42;
const TASK = "Say hello in a file";
/** The floor repo's project credential; only ever sent to the fake GitHub. */
const REPO_TOKEN = `ghp_e2eFakeToken${run}`;

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dataDir = "";
let prefix = "";
let github: FakeGitHub;
let office: AgentOffice;
let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let ownerPage: Page;
let memberPage: Page;
let ownerTerminal: { text(): string };
let ownerId = "";
let agentId = "";
let seatId = "";
/** The human's clone of the floor repo that holds the agent's branch (its git common dir). */
let cloneGitDir = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  if (!dockerAvailable()) {
    // CI must run this flow; locally it needs a Docker daemon.
    if (process.env.CI) throw new Error("the agents e2e needs a Docker daemon");
    test.skip(true, "needs a Docker daemon (docker runner backend)");
  }
  buildRunnerImage();
  dataDir = mkdtempSync(join(tmpdir(), "regulus-e2e-agents-"));
  prefix = `rge2e-${run}`;
  github = await startFakeGitHub();
  office = new AgentOffice({
    dataDir,
    port: Number(process.env.E2E_AGENTS_PORT ?? 4620),
    githubApiBase: github.url,
    prefix,
  });
  createRemoteRepo(dataDir, REPO.owner, REPO.name, REPO.branch);
  await office.start();
  ownerCtx = await browser.newContext({ baseURL: office.baseURL });
  memberCtx = await browser.newContext({ baseURL: office.baseURL });
  ownerPage = await ownerCtx.newPage();
  memberPage = await memberCtx.newPage();
  ownerTerminal = collectTerminalOutput(ownerPage);
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && office) {
    // Written into test-results/ so CI uploads it with the trace.
    const path = testInfo.outputPath("office-server.log");
    writeFileSync(path, office.log());
    await testInfo.attach("office-server.log", { path, contentType: "text/plain" });
  }
});

test.afterAll(async () => {
  await ownerCtx?.close();
  await memberCtx?.close();
  await office?.stop();
  if (prefix) cleanupRunners(prefix);
  await github?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// ---- helpers -------------------------------------------------------------------------------

const bare = () => join(dataDir, "remotes", REPO.owner, `${REPO.name}.git`);
const tmuxSocket = () => `/run/office/tmux/${ownerId}.sock`;
const runnerName = () => `${prefix}-runner-${ownerId}`;

/** `tmux` inside the owner's runner container, as the runner user. */
function runnerTmux(args: string[]): string {
  return sh("docker", ["exec", runnerName(), "tmux", "-S", tmuxSocket(), ...args]);
}

/**
 * This agent's worktree as the office sees it: `<worktrees>/<floor>/<runner id>/<agentId>`
 * (the human's own area, #114), or null once it is gone.
 */
function worktreePath(): string | null {
  const root = office.worktreesDir;
  for (const floor of readdirSync(root)) {
    for (const area of readdirSync(join(root, floor))) {
      const dir = join(root, floor, area, agentId);
      if (existsSync(dir)) return dir;
    }
  }
  return null;
}

/** git inside the agent's worktree (as the office user, on the host). */
function worktreeGit(args: string[]): string {
  const dir = worktreePath();
  if (!dir) throw new Error("agent worktree missing");
  return sh("git", ["-C", dir, ...args]);
}

async function register(page: Page, who: typeof owner, submit: string): Promise<void> {
  await page.getByLabel("Display name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByLabel("Confirm password").fill(who.password);
  await page.getByRole("button", { name: submit }).click();
  await expect(page).toHaveURL(/\/office/);
}

/** A same-origin JSON API call with the page's session cookie. */
async function api(page: Page, method: string, path: string, data?: unknown): Promise<unknown> {
  const res = await page.request.fetch(path, {
    method,
    headers: { origin: office.baseURL },
    ...(data === undefined ? {} : { data }),
  });
  expect(res.ok(), `${method} ${path} -> ${res.status()}`).toBe(true);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function rideTo(page: Page, floor: string): Promise<void> {
  const elevator = page.getByRole("navigation", { name: "Elevator" });
  await elevator.getByRole("button", { name: new RegExp(`\\d+\\. ${floor}`) }).click();
  await expect(page.locator(".rg-topbar__floor")).toHaveText(floor);
  await expect(page.getByRole("list", { name: "Work on this floor" })).toBeVisible();
}

/** Opens the robot panel by clicking its desk (occupied desks open the panel). */
async function openRobotPanel(page: Page): Promise<void> {
  await page.bringToFront();
  const panel = page.locator("section.rg-agent-panel");
  if (await panel.isVisible()) return;
  await expect(async () => {
    const point = await scenePoint(page, `desk-hotspot-${seatId}`);
    if (!point) throw new Error("robot desk not in view");
    await page.mouse.click(point.x, point.y);
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(panel.locator('[data-key="task"] dd')).toHaveText(TASK);
}

const robotOn = async (page: Page) => (await robots(page))[agentId];

// ---- the flow ------------------------------------------------------------------------------

test("the owner and an invited member sign in", async () => {
  await ownerPage.goto("/login");
  await register(ownerPage, owner, "Create the owner account");
  const me = (await api(ownerPage, "GET", "/api/me")) as { id: string; role: string };
  expect(me.role).toBe("owner");
  ownerId = me.id;

  const invite = (await api(ownerPage, "POST", "/api/invites", { role: "member" })) as {
    url: string;
  };
  await memberPage.goto(invite.url);
  await register(memberPage, member, "Create account and join");
  expect(await api(memberPage, "GET", "/api/me")).toMatchObject({ role: "member" });
});

test("1. the owner creates a floor from the bare repo and rides to it", async () => {
  await ownerPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(ownerPage);
  const elevator = ownerPage.getByRole("navigation", { name: "Elevator" });
  await elevator.getByRole("button", { name: "Add floor…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Add floor" });
  await dialog.getByLabel("Floor name").fill(FLOOR);
  await dialog.getByLabel("Repo 1", { exact: true }).fill(`${REPO.owner}/${REPO.name}`);
  await dialog.getByLabel("Access token for repo 1").fill(REPO_TOKEN);
  await dialog.getByRole("button", { name: "Create floor" }).click();
  const added = ownerPage.getByRole("dialog", { name: "Floor added" });
  await expect(added.getByText(`Ready on ${REPO.branch}`)).toBeVisible();

  // A new floor offers "Add people" straight away: the owner lets the member watch (#131).
  await added.getByRole("button", { name: "Add people…" }).click();
  const settings = ownerPage.getByRole("dialog", { name: "Floor settings" });
  await settings.getByLabel("Search people").fill("ben");
  await settings.getByRole("checkbox", { name: new RegExp(member.name) }).check();
  await settings.getByLabel("Access for the people you add").selectOption("view");
  await settings.getByRole("button", { name: "Add 1 person" }).click();
  await expect(settings.getByLabel(`Access for ${member.name}`)).toHaveValue("view");
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toHaveCount(0);
  await rideTo(ownerPage, FLOOR);

  await memberPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(memberPage);
  await rideTo(memberPage, FLOOR);
});

test("2. the owner spawns Claude Code at a free desk with their login and a prompt", async () => {
  await ownerPage.bringToFront();
  await recordRobots(ownerPage);
  await recordRobots(memberPage);
  await expect.poll(() => freeDeskPoint(ownerPage)).not.toBeNull();
  const desk = await freeDeskPoint(ownerPage);
  if (!desk) throw new Error("no free desk in the scene");
  seatId = desk.seatId;
  // The dialog asks the runner whether the CLI is logged in (`claude auth status`, a piped
  // process the fake answers after a pause). The spec spawns without waiting for it, so the
  // spawn's first mount of the floor recreates the runner while the check is still running:
  // the mount waits for the check (#126) instead of failing with RunnerBusyError.
  const loginChecked = ownerPage.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/provider-logins",
  );
  await ownerPage.mouse.click(desk.x, desk.y);
  const dialog = ownerPage.getByRole("dialog", { name: "Spawn a robot" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(seatId)).toBeVisible();
  await expect(dialog.getByLabel("Repo")).toHaveValue(/.+/);
  await expect(dialog.getByLabel("Provider")).toHaveValue("claude-code");
  // The default credential: the owner's own Claude Code login (no profile, no secret field).
  await expect(dialog.getByLabel("Credentials")).toContainText("Your Claude Code login");
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await dialog.getByLabel("Task title").fill(TASK);
  await dialog.getByLabel("Issue").fill(String(ISSUE));
  await dialog.getByLabel("Prompt").fill("Add a FAKE_CLAUDE.md that says hello");
  await dialog.getByRole("button", { name: "Spawn robot" }).click();
  // The dialog stays pending until our robot sits down at that desk, then closes.
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  // The login check ran to completion (the recreate did not kill it): Claude Code connected.
  const logins = await loginChecked;
  expect(logins.ok()).toBe(true);
  expect((await logins.json()).providers).toContainEqual(
    expect.objectContaining({ provider: "claude-code", connected: true }),
  );

  await expect.poll(async () => Object.values(await robots(ownerPage)).length).toBe(1);
  const [robot] = Object.values(await robots(ownerPage));
  if (!robot) throw new Error("robot missing");
  agentId = robot.agentId;
  expect(robot).toMatchObject({ seatId, seated: true });
  // The member sees the same robot at the same desk.
  await expect.poll(async () => (await robotOn(memberPage))?.seatId).toBe(seatId);
});

test("3. the robot's status and action change (editing) and it raises its hand", async () => {
  // The fake posts UserPromptSubmit (thinking), PreToolUse(Edit) (editing), then
  // PermissionRequest (waiting_permission, hand up).
  await expect
    .poll(() => history(ownerPage), { timeout: 60_000 })
    .toContainEqual(expect.stringMatching(/^working\/editing\/sit_type\//));
  const seen = await history(ownerPage);
  expect(seen).toContainEqual(expect.stringMatching(/^working\/thinking\//));
  expect(seen.findIndex((s) => s.startsWith("working/thinking/"))).toBeLessThan(
    seen.findIndex((s) => s.startsWith("working/editing/")),
  );
  for (const page of [ownerPage, memberPage]) {
    await expect
      .poll(async () => {
        const r = await robotOn(page);
        return r && { status: r.status, handRaised: r.handRaised, seated: r.seated };
      })
      .toEqual({ status: "waiting_permission", handRaised: true, seated: true });
  }
  await expect
    .poll(() => history(memberPage))
    .toContainEqual(expect.stringMatching(/^waiting_permission\/.*\/hand$/));
});

test("4. the permission prompt reaches the owner, not the member", async () => {
  // A fresh request opens the prompt for the robot's controllers by itself.
  const prompt = ownerPage.getByRole("dialog", { name: "Permission needed" });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(`“${TASK}” wants to use`);
  await expect(prompt.getByText("Edit", { exact: true })).toBeVisible();
  await expect(prompt.getByLabel("What would run")).toContainText("FAKE_CLAUDE.md");

  // The member watches the same robot: hand up, but no request, no prompt, no controls.
  await openRobotPanel(memberPage);
  const memberPanel = memberPage.locator("section.rg-agent-panel");
  await expect(memberPanel.locator('[data-key="status"] dd')).toHaveText("Waiting for approval");
  await expect(memberPanel.getByRole("button", { name: "Watch terminal" })).toBeVisible();
  await expect(memberPanel.getByText(/Only Ada Owner or an admin can control/)).toBeVisible();
  await expect(memberPanel.getByRole("button", { name: /Review request/ })).toHaveCount(0);
  await expect(memberPage.getByRole("dialog", { name: "Permission needed" })).toHaveCount(0);
  await expect(memberPage.getByText("FAKE_CLAUDE.md")).toHaveCount(0);
  expect((await robotOn(memberPage))?.handRaised).toBe(true);
});

test("5. the owner approves; the robot commits and finishes", async () => {
  await ownerPage.bringToFront();
  const prompt = ownerPage.getByRole("dialog", { name: "Permission needed" });
  await prompt.getByRole("button", { name: "Allow once" }).click();
  await expect(prompt).toHaveCount(0);
  await openRobotPanel(ownerPage);
  for (const page of [ownerPage, memberPage]) {
    await expect
      .poll(async () => {
        const r = await robotOn(page);
        return r && { status: r.status, handRaised: r.handRaised };
      })
      .toEqual({ status: "done", handRaised: false });
  }
  await expect
    .poll(() => history(ownerPage))
    .toContainEqual(
      // Done plays the celebration (the Stop hook resets the action; the status drives the clip).
      expect.stringMatching(/^done\/\w+\/celebrate\//),
    );
  const ownerPanel = ownerPage.locator("section.rg-agent-panel");
  await expect(ownerPanel.locator('[data-key="status"] dd')).toHaveText("Done");
  const branch = await ownerPanel.locator('[data-key="branch"] dd').innerText();
  expect(branch).toMatch(/^office\//);
  // The fake agent's commit is on the robot's branch in its worktree, on top of origin/trunk.
  expect(worktreeGit(["rev-parse", "--abbrev-ref", "HEAD"])).toBe(branch);
  expect(worktreeGit(["log", "-1", "--format=%s"])).toBe("Add FAKE_CLAUDE.md");
  expect(worktreeGit(["rev-list", "--count", `origin/${REPO.branch}..HEAD`])).toBe("1");
  expect(worktreeGit(["status", "--porcelain"])).toBe("");
  cloneGitDir = worktreeGit(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
});

test("6. Open PR pushes the branch and sends a correct PR to GitHub", async () => {
  const ownerPanel = ownerPage.locator("section.rg-agent-panel");
  const branch = await ownerPanel.locator('[data-key="branch"] dd').innerText();
  await ownerPanel.getByRole("button", { name: "Open PR" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Open pull request" });
  await expect(dialog.getByLabel("Title")).toHaveValue(TASK);
  await expect(dialog.getByLabel("Description")).toHaveValue(new RegExp(`Closes #${ISSUE}`));
  await dialog.getByRole("button", { name: "Open PR" }).click();
  const link = dialog.getByRole("status").getByRole("link", { name: "#1" });
  await expect(link).toHaveAttribute(
    "href",
    `https://github.com/${REPO.owner}/${REPO.name}/pull/1`,
  );
  // The dialog opens PRs as drafts by default.
  await expect(dialog.getByRole("status")).toContainText(`from ${branch} (draft)`);

  const posts = github.requests.filter((r) => r.method === "POST");
  expect(posts).toHaveLength(1);
  const [post] = posts;
  expect(post?.path).toBe(`/repos/${REPO.owner}/${REPO.name}/pulls`);
  expect(post?.headers.authorization).toBe(`Bearer ${REPO_TOKEN}`);
  expect(post?.headers["x-github-api-version"]).toBe("2022-11-28");
  expect(post?.body).toMatchObject({ head: branch, base: REPO.branch, title: TASK, draft: true });
  expect((post?.body as { body: string }).body).toContain(`Closes #${ISSUE}`);
  // The branch was pushed to the (file://) remote with the agent's commit.
  expect(sh("git", ["--git-dir", bare(), "log", "-1", "--format=%s", branch])).toBe(
    "Add FAKE_CLAUDE.md",
  );
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(ownerPage.locator('section.rg-agent-panel [data-key="pull request"] dd')).toHaveText(
    "#1",
  );
});

test("7. after an office-server restart the robot and its tmux session are still there", async () => {
  const session = `=agent-${agentId}:`;
  const before = runnerTmux([
    "display-message",
    "-p",
    "-t",
    session,
    "#{pane_pid} #{session_created}",
  ]);
  const oldPid = office.pid;

  await office.restart();
  expect(office.pid).not.toBe(oldPid);

  // Same pane process, same session: re-adopted, not re-run.
  expect(
    runnerTmux(["display-message", "-p", "-t", session, "#{pane_pid} #{session_created}"]),
  ).toBe(before);
  for (const page of [ownerPage, memberPage]) {
    await page.goto(OFFICE_PROBE_PATH);
    await waitForScene(page);
    await rideTo(page, FLOOR);
    await expect
      .poll(async () => {
        const r = await robotOn(page);
        return r && { status: r.status, seatId: r.seatId, seated: r.seated };
      })
      .toEqual({ status: "done", seatId, seated: true });
  }

  // Its terminal still opens and shows the agent's screen (scrollback over the socket).
  await openRobotPanel(ownerPage);
  const seenBefore = ownerTerminal.text().length;
  await ownerPage
    .locator("section.rg-agent-panel")
    .getByRole("button", { name: "Open terminal" })
    .click();
  const terminal = ownerPage.getByRole("dialog").filter({ hasText: /In control|Watching/ });
  await expect(terminal).toBeVisible();
  await expect.poll(() => ownerTerminal.text().slice(seenBefore)).toContain("FAKE CLAUDE DONE");
  await expect(terminal.getByText(/Reconnecting|ended/i)).toHaveCount(0);
  await ownerPage.keyboard.press("Escape");
  if (await terminal.isVisible())
    await terminal.getByRole("button", { name: /Close/ }).first().click();
  await expect(terminal).toHaveCount(0);
});

test("8. send home frees the desk and deletes the branch as chosen", async () => {
  const ownerPanel = ownerPage.locator("section.rg-agent-panel");
  await openRobotPanel(ownerPage);
  const branch = await ownerPanel.locator('[data-key="branch"] dd').innerText();
  await ownerPanel.getByRole("button", { name: "Send home" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Send robot home" });
  await expect(dialog.getByText(branch)).toBeVisible();
  await dialog.getByLabel(/Delete the branch/).check();
  await dialog.getByRole("button", { name: "Send home" }).click();
  await expect(dialog).toHaveCount(0);

  for (const page of [ownerPage, memberPage]) {
    await expect.poll(() => robotOn(page), { timeout: 30_000 }).toBeUndefined();
  }
  // The tmux session is gone, the worktree removed, the branch deleted here and on the remote.
  expect(() => runnerTmux(["has-session", "-t", `=agent-${agentId}`])).toThrow();
  expect(worktreePath()).toBeNull();
  expect(sh("git", ["--git-dir", cloneGitDir, "branch", "--list", branch])).toBe("");
  expect(sh("git", ["--git-dir", bare(), "branch", "--list", branch])).toBe("");

  // The desk is free again: clicking it opens the spawn dialog for that seat.
  await ownerPage.bringToFront();
  await expect.poll(() => scenePoint(ownerPage, `desk-hotspot-${seatId}`)).not.toBeNull();
  const point = await scenePoint(ownerPage, `desk-hotspot-${seatId}`);
  if (!point) throw new Error("desk not in view");
  await ownerPage.mouse.click(point.x, point.y);
  const spawn = ownerPage.getByRole("dialog", { name: "Spawn a robot" });
  await expect(spawn).toBeVisible();
  await expect(spawn.getByText(seatId)).toBeVisible();
  await spawn.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(spawn).toHaveCount(0);
});
