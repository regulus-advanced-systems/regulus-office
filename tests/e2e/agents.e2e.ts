/**
 * M1 exit criteria, automated half (docs/SPEC.md §10 M1, issue #120): an owner spawns a
 * Claude Code henchman at a desk on an operation cloned from a (local, file://) repo; the henchman
 * animates by action and raises its hand; the permission prompt reaches the owner but not a
 * second member's browser, nor an office admin's, who gets only the emergency stop (#138); approving lets the agent commit; the one-click PR reaches a fake
 * GitHub with `Closes #n`; restarting office-server re-adopts the same tmux session, whose
 * terminal still opens, copies, expands and reflows (#156); copying works in every terminal
 * surface while the fake turns on mouse tracking like Claude Code (#164); a member finds the
 * henchman's output with search and jumps from the lobby to its desk (#41); a bang on the merge
 * gong makes the henchman cheer in its chair and sit back exactly as it was (#43); sending the henchman
 * home frees the desk and deletes the branch as chosen.
 *
 * The agent is the fake `claude` in tests/e2e/runner (never the real CLI, no account, no
 * network beyond the office's hook URL), run by the production `docker` runner backend in a
 * small test runner image. The spec starts, restarts and stops its own office-server in
 * production mode (tests/e2e/agentOffice.ts). Run with `bun run e2e:agents`; needs Docker.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { collectAgentDiagnostics } from "./agentDiagnostics.ts";
import {
  AgentOffice,
  buildRunnerImage,
  cleanupRunners,
  dockerAvailable,
  sh,
} from "./agentOffice.ts";
import {
  collectTerminalOutput,
  henchmen,
  history,
  recordHenchmen,
  scenePoint,
  statuses,
} from "./agentProbes.ts";
import { type BoneSegment, boneSegments, recordBones, sampleBones } from "./boneProbes.ts";
import { settledVerdict } from "./buildChecks.ts";
import { checkChangesWindow } from "./changesChecks.ts";
import { walkInto, walkToLobby } from "./compoundProbes.ts";
import {
  checkHenchmanTerminalCopy,
  checkLaptopCopy,
  checkLoginTerminalCopy,
} from "./copyChecks.ts";
import { type FakeGitHub, startFakeGitHub } from "./fakeGitHub.ts";
import { pickGenius } from "./geniusChecks.ts";
import { createRemoteRepo } from "./gitRemote.ts";
import { checkHenchmanCheers } from "./gongChecks.ts";
import { freeDeskPoint, OFFICE_PROBE_PATH, waitForScene } from "./probes.ts";
import { checkHenchmanTerminal } from "./terminalChecks.ts";

const run = Date.now().toString(36);
const owner = { name: "Ada Owner", email: `owner-${run}@example.com`, password: `owner-pw-${run}` };
const member = {
  name: "Ben Member",
  email: `member-${run}@example.com`,
  password: `member-pw-${run}`,
};
const admin = { name: "Cy Admin", email: `admin-${run}@example.com`, password: `admin-pw-${run}` };
const REPO = { owner: "octo", name: "henchmen", branch: "trunk" };
const OPERATION = "Hangar";
const ISSUE = 42;
const TASK = "Say hello in a file";
/**
 * The office GitHub connection's org token (#141), the operation repo's project credential; only
 * ever sent to the fake GitHub.
 */
const REPO_TOKEN = `github_pat_e2eFakeOrgToken${run}`;

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dataDir = "";
let prefix = "";
let github: FakeGitHub;
let office: AgentOffice;
let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let adminCtx: BrowserContext;
let ownerPage: Page;
let memberPage: Page;
let adminPage: Page;
let ownerTerminal: { text(): string };
let ownerId = "";
let agentId = "";
let seatId = "";
/** The human's clone of the operation repo that holds the agent's branch (its git common dir). */
let cloneGitDir = "";
/** A test failed: afterAll keeps the run's diagnostics too. */
let failed = false;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  if (!dockerAvailable()) {
    // CI must run this flow; locally it needs a Docker daemon.
    if (process.env.CI) throw new Error("the agents e2e needs a Docker daemon");
    test.skip(true, "needs a Docker daemon (docker runner backend)");
  }
  buildRunnerImage();
  dataDir = mkdtempSync(join(tmpdir(), "regulus-e2e-agents-"));
  // Container and volume name prefix; E2E_RUNNER_PREFIX keeps parallel worktrees apart.
  prefix = `${process.env.E2E_RUNNER_PREFIX ?? "rge2e"}-${run}`;
  github = await startFakeGitHub({
    orgToken: REPO_TOKEN,
    repos: [
      { owner: REPO.owner, name: REPO.name, defaultBranch: REPO.branch },
      { owner: REPO.owner, name: "unused", defaultBranch: "main" },
    ],
  });
  office = new AgentOffice({
    dataDir,
    port: Number(process.env.E2E_AGENTS_PORT ?? 4620),
    githubApiBase: github.url,
    prefix,
  });
  createRemoteRepo(dataDir, REPO.owner, REPO.name, REPO.branch);
  await office.start();
  ownerCtx = await browser.newContext({
    baseURL: office.baseURL,
    // The terminal step (#156) checks what a selection put on the clipboard.
    permissions: ["clipboard-read", "clipboard-write"],
  });
  memberCtx = await browser.newContext({ baseURL: office.baseURL });
  adminCtx = await browser.newContext({ baseURL: office.baseURL });
  ownerPage = await ownerCtx.newPage();
  memberPage = await memberCtx.newPage();
  adminPage = await adminCtx.newPage();
  ownerTerminal = collectTerminalOutput(ownerPage);
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && office) {
    failed = true;
    // Written into test-results/ so CI uploads it with the trace (agentDiagnostics.ts).
    const files = collectAgentDiagnostics(testInfo.outputPath("diagnostics"), {
      prefix,
      serverLog: office.log(),
    });
    for (const path of files) {
      await testInfo.attach(basename(path), { path, contentType: "text/plain" });
    }
  }
});

test.afterAll(async ({}, testInfo) => {
  // A failure outside a test (beforeAll, a hook) leaves no per-test diagnostics: keep them here.
  if ((failed || testInfo.status !== testInfo.expectedStatus) && office) {
    collectAgentDiagnostics(join(testInfo.project.outputDir, "agents-diagnostics"), {
      prefix,
      serverLog: office.log(),
    });
  }
  await ownerCtx?.close();
  await memberCtx?.close();
  await adminCtx?.close();
  await office?.close();
  if (prefix) cleanupRunners(prefix);
  await github?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// ---- helpers -------------------------------------------------------------------------------

const bare = () => join(dataDir, "remotes", REPO.owner, `${REPO.name}.git`);
const tmuxSocket = () => `/run/office/tmux/${ownerId}.sock`;
/** The henchman's own sandbox container (#169); its tmux server has the henchman's session. */
const sandboxName = () => `${prefix}-sbx-${agentId}`;

/** `tmux` inside the henchman's sandbox, as the runner user. */
function henchmanTmux(args: string[]): string {
  return sh("docker", ["exec", sandboxName(), "tmux", "-S", tmuxSocket(), ...args]);
}

/**
 * This agent's worktree as the office sees it: `<worktrees>/<operation>/<runner id>/<agentId>`
 * (the human's own area, #114), or null once it is gone.
 */
function worktreePath(): string | null {
  const root = office.worktreesDir;
  for (const operation of readdirSync(root)) {
    for (const area of readdirSync(join(root, operation))) {
      const dir = join(root, operation, area, agentId);
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
  // First login opens the genius picker (#185).
  await pickGenius(page, "Hacker");
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

/** Opens the henchman panel by clicking its desk (occupied desks open the panel). */
async function openHenchmanPanel(page: Page): Promise<void> {
  await page.bringToFront();
  const panel = page.locator("section.rg-agent-panel");
  if (await panel.isVisible()) return;
  await expect(async () => {
    const point = await scenePoint(page, `desk-hotspot-${seatId}`);
    if (!point) throw new Error("henchman desk not in view");
    await page.mouse.click(point.x, point.y);
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(panel.locator('[data-key="task"] dd')).toHaveText(TASK);
}

const henchmanOn = async (page: Page) => (await henchmen(page))[agentId];

/** Runs of the recording in which the henchman sat typing at its laptop long enough to judge. */
const typing = (segments: BoneSegment[]) =>
  segments.filter((s) => /^working\/\w+\/sit_type\//.test(s.key) && s.ms >= 500);

/** Lets the fake `claude` stop editing and ask for permission (tests/e2e/runner/claude). */
function letFakeAsk(): void {
  sh("docker", ["exec", sandboxName(), "sh", "-c", 'touch "$HOME/.fake-claude-ask"']);
}

// ---- the flow ------------------------------------------------------------------------------

test("the owner, an invited member and an invited admin sign in", async () => {
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

  const adminInvite = (await api(ownerPage, "POST", "/api/invites", { role: "admin" })) as {
    url: string;
  };
  await adminPage.goto(adminInvite.url);
  await register(adminPage, admin, "Create account and join");
  expect(await api(adminPage, "GET", "/api/me")).toMatchObject({ role: "admin" });
});

test("1. the owner connects GitHub, picks the repo in Add operation and walks into its room", async () => {
  await ownerPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(ownerPage);
  // Settings → GitHub: connect the office with an org token (#141; the App flow needs github.com).
  await ownerPage.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = ownerPage.getByRole("dialog", { name: "Settings" });
  const github = settingsDialog.getByRole("region", { name: "GitHub" });
  await expect(github.getByText("Not connected")).toBeVisible();
  await github.getByLabel("Or an organization access token").fill(REPO_TOKEN);
  await github.getByRole("button", { name: "Connect with token" }).click();
  await expect(github.getByText("Connected with an organization token (org-bot).")).toBeVisible();
  await expect(github.getByLabel("Or an organization access token")).toHaveCount(0);
  await settingsDialog.getByRole("button", { name: "Done" }).click();
  await expect(settingsDialog).toHaveCount(0);

  const rooms = ownerPage.getByRole("navigation", { name: "Rooms" });
  await rooms.getByRole("button", { name: "New operation…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "New operation" });
  await dialog.getByLabel("Operation name").fill(OPERATION);
  const picker = dialog.getByRole("list", { name: "Repos from GitHub" });
  await dialog.getByLabel("Search repos").fill(REPO.name);
  await expect(picker.getByRole("checkbox")).toHaveCount(1);
  await picker.getByRole("checkbox", { name: new RegExp(`${REPO.owner}/${REPO.name}`) }).check();
  await expect(picker.getByText(`private · ${REPO.branch}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Choose a spot…" }).click();
  // Build mode (#187): build where it offers.
  expect((await settledVerdict(ownerPage)).server?.ok).toBe(true);
  await ownerPage.keyboard.press("Enter");
  const added = ownerPage.getByRole("dialog", { name: "Operation set up" });
  await expect(added.getByText(`Ready on ${REPO.branch}`)).toBeVisible();

  // A new operation offers "Add people" straight away: the owner lets the member watch (#131).
  await added.getByRole("button", { name: "Add people…" }).click();
  const settings = ownerPage.getByRole("dialog", { name: "Operation settings" });
  await settings.getByLabel("Search people").fill("ben");
  await settings.getByRole("checkbox", { name: new RegExp(member.name) }).check();
  await settings.getByLabel("Access for the people you add").selectOption("view");
  await settings.getByRole("button", { name: "Add 1 person" }).click();
  await expect(settings.getByLabel(`Access for ${member.name}`)).toHaveValue("view");
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toHaveCount(0);
  await walkInto(ownerPage, OPERATION);

  await memberPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(memberPage);
  await walkInto(memberPage, OPERATION);
});

test("2. the owner spawns Claude Code at a free desk with their login and a prompt", async () => {
  await ownerPage.bringToFront();
  await recordHenchmen(ownerPage);
  await recordHenchmen(memberPage);
  await recordBones(ownerPage);
  await expect.poll(() => freeDeskPoint(ownerPage)).not.toBeNull();
  const desk = await freeDeskPoint(ownerPage);
  if (!desk) throw new Error("no free desk in the scene");
  seatId = desk.seatId;
  // The dialog asks the runner whether the CLI is logged in (`claude auth status`, a piped
  // process the fake answers after a pause). The spec spawns without waiting for it, so the
  // spawn's first mount of the operation recreates the runner while the check is still running:
  // the mount waits for the check (#126) instead of failing with RunnerBusyError.
  const loginChecked = ownerPage.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/provider-logins",
  );
  await ownerPage.mouse.click(desk.x, desk.y);
  const dialog = ownerPage.getByRole("dialog", { name: "Spawn a henchman" });
  await expect(dialog).toBeVisible();
  // The operation's only repo is preselected and named next to the desk, not asked for (#142).
  await expect(dialog.getByText(`Desk ${seatId} · ${REPO.owner}/${REPO.name}`)).toBeVisible();
  // The main form: model (focused, grouped by provider) and effort, with defaults.
  const opus = dialog.getByRole("group", { name: "Claude Code" }).getByRole("radio", {
    name: "Opus",
  });
  await expect(opus).toBeChecked();
  await expect(opus).toBeFocused();
  await expect(dialog.getByRole("radio", { name: "Medium" })).toBeChecked();
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  // More options: the default credential is the owner's own Claude Code login (no secret).
  await dialog.getByRole("button", { name: "More options" }).click();
  await expect(dialog.getByLabel("Credentials")).toContainText("Your Claude Code login");
  await expect(dialog.getByRole("switch", { name: /Own worktree/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await dialog.getByLabel("Task title").fill(TASK);
  await dialog.getByLabel("Issue").fill(String(ISSUE));
  // The fake holds the edit until step 3 has seen the henchman type (tests/e2e/runner/claude, #179).
  await dialog.getByLabel(/^Prompt/).fill("Add a FAKE_CLAUDE.md that says hello [hold the edit]");
  await dialog.getByRole("button", { name: "Spawn henchman" }).click();
  // The dialog stays pending until our henchman sits down at that desk, then closes.
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  // The login check ran to completion (the recreate did not kill it): Claude Code connected.
  const logins = await loginChecked;
  expect(logins.ok()).toBe(true);
  expect((await logins.json()).providers).toContainEqual(
    expect.objectContaining({ provider: "claude-code", connected: true }),
  );

  await expect.poll(async () => Object.values(await henchmen(ownerPage)).length).toBe(1);
  const [henchman] = Object.values(await henchmen(ownerPage));
  if (!henchman) throw new Error("henchman missing");
  agentId = henchman.agentId;
  expect(henchman).toMatchObject({ seatId, seated: true });
  // The member sees the same henchman at the same desk.
  await expect.poll(async () => (await henchmanOn(memberPage))?.seatId).toBe(seatId);
});

test("3. the henchman's status and action change (editing) and it raises its hand", async () => {
  // The fake posts UserPromptSubmit (thinking), PreToolUse(Edit) (editing), then
  // PermissionRequest (waiting_permission, hand up).
  // The order the page received them in (#179): a software-rendered CI page can get thinking and
  // editing between two frames and never draw the 1 s of thinking.
  await expect
    .poll(() => statuses(ownerPage, agentId), { timeout: 60_000 })
    .toContain("working/editing");
  const seen = await statuses(ownerPage, agentId);
  expect(seen).toContain("working/thinking");
  expect(seen.indexOf("working/thinking")).toBeLessThan(seen.indexOf("working/editing"));
  // The fake keeps editing until told (#179). The henchman starts typing once the action has held
  // for 1.5 s, and a software-rendered CI page gets the status late and draws a few frames a
  // second: wait until this page has drawn the typing clip moving the bones (3b), then go on.
  const typed = async () =>
    Math.max(0, ...typing(await boneSegments(ownerPage, agentId)).map((s) => s.maxDeg));
  await expect.poll(typed, { timeout: 60_000 }).toBeGreaterThan(3);
  letFakeAsk();
  for (const page of [ownerPage, memberPage]) {
    await expect
      .poll(async () => {
        const r = await henchmanOn(page);
        return r && { status: r.status, handRaised: r.handRaised, seated: r.seated };
      })
      .toEqual({ status: "waiting_permission", handRaised: true, seated: true });
  }
  await expect
    .poll(() => history(memberPage))
    .toContainEqual(expect.stringMatching(/^waiting_permission\/.*\/hand$/));
});

test("3b. the henchman's bones move while it works and hold still while it waits (#159)", async () => {
  // The recorder has watched the henchman since before the spawn: starting, working, then
  // waiting_permission with its hand up. Wait until the calm, hand-up pose has had a while.
  await expect
    .poll(
      async () =>
        (await boneSegments(ownerPage, agentId)).some(
          (s) => /^waiting_permission\/\w+\/sit_idle\/hand$/.test(s.key) && s.ms >= 1500,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  const segments = await boneSegments(ownerPage, agentId);
  const report = JSON.stringify(segments);
  // The status/action stream and how far the bones moved in each state, for the report.
  await test.info().attach("bone-segments.json", {
    body: JSON.stringify({ history: await history(ownerPage), segments }, null, 1),
    contentType: "application/json",
  });
  // Working at the laptop (typing/editing) animates the arms and head.
  const working = typing(segments);
  expect(working.length, report).toBeGreaterThan(0);
  expect(Math.max(...working.map((s) => s.maxDeg)), report).toBeGreaterThan(3);
  // Seated and not working (starting, idle, waiting with the hand up): still, to a tenth of a degree.
  // At least two frames past the crossfade: CI renders the scene in software at a few fps.
  const calm = segments.filter(
    (s) => /^(starting|idle|waiting_permission)\/\w+\/sit_idle\//.test(s.key) && s.frames >= 2,
  );
  expect(calm.length, report).toBeGreaterThan(0);
  for (const s of calm) expect(s.maxDeg, report).toBeLessThan(0.1);
});

test("4. the permission prompt reaches the owner, not the member nor an admin", async () => {
  // A fresh request opens the prompt for the henchman's owner by itself.
  const prompt = ownerPage.getByRole("dialog", { name: "Permission needed" });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(`“${TASK}” wants to use`);
  await expect(prompt.getByText("Edit", { exact: true })).toBeVisible();
  await expect(prompt.getByLabel("What would run")).toContainText("FAKE_CLAUDE.md");

  // The member watches the same henchman: hand up, but no request, no prompt, no controls.
  await openHenchmanPanel(memberPage);
  const memberPanel = memberPage.locator("section.rg-agent-panel");
  await expect(memberPanel.locator('[data-key="status"] dd')).toHaveText("Waiting for approval");
  await expect(memberPanel.getByRole("button", { name: "Watch terminal" })).toBeVisible();
  await expect(memberPanel.getByText("Only Ada Owner can control this henchman.")).toBeVisible();
  await expect(memberPanel.getByRole("button", { name: /Review request/ })).toHaveCount(0);
  await expect(memberPanel.getByRole("button", { name: "Emergency stop" })).toHaveCount(0);
  await expect(memberPage.getByRole("dialog", { name: "Permission needed" })).toHaveCount(0);
  await expect(memberPage.getByText("FAKE_CLAUDE.md")).toHaveCount(0);
  expect((await henchmanOn(memberPage))?.handRaised).toBe(true);

  // An office admin (#138) watches too: no request, no prompt, no controls; only the
  // emergency stop (not pressed here; the server tests cover it).
  await adminPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(adminPage);
  await walkInto(adminPage, OPERATION);
  await openHenchmanPanel(adminPage);
  const adminPanel = adminPage.locator("section.rg-agent-panel");
  await expect(adminPanel.locator('[data-key="status"] dd')).toHaveText("Waiting for approval");
  await expect(adminPanel.getByRole("button", { name: "Watch terminal" })).toBeVisible();
  await expect(adminPanel.getByText("Only Ada Owner can control this henchman.")).toBeVisible();
  await expect(adminPanel.getByRole("button", { name: "Emergency stop" })).toBeVisible();
  await expect(adminPanel.getByRole("button", { name: /Review request/ })).toHaveCount(0);
  await expect(adminPanel.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(adminPage.getByRole("dialog", { name: "Permission needed" })).toHaveCount(0);
  await expect(adminPage.getByText("FAKE_CLAUDE.md")).toHaveCount(0);
  await adminCtx.close();
});

test("5. the owner approves; the henchman commits and finishes", async () => {
  await ownerPage.bringToFront();
  const prompt = ownerPage.getByRole("dialog", { name: "Permission needed" });
  await prompt.getByRole("button", { name: "Allow once" }).click();
  await expect(prompt).toHaveCount(0);
  await openHenchmanPanel(ownerPage);
  for (const page of [ownerPage, memberPage]) {
    await expect
      .poll(async () => {
        const r = await henchmanOn(page);
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
  // The fake agent's commit is on the henchman's branch in its worktree, on top of origin/trunk.
  expect(worktreeGit(["rev-parse", "--abbrev-ref", "HEAD"])).toBe(branch);
  expect(worktreeGit(["log", "-1", "--format=%s"])).toBe("Add FAKE_CLAUDE.md");
  expect(worktreeGit(["rev-list", "--count", `origin/${REPO.branch}..HEAD`])).toBe("1");
  expect(worktreeGit(["status", "--porcelain"])).toBe("");
  cloneGitDir = worktreeGit(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
});

test("5b. once the celebration is over the done henchman sits still (#159)", async () => {
  await expect
    .poll(async () => (await henchmanOn(ownerPage))?.animation, { timeout: 20_000 })
    .toBe("sit_idle");
  // Past the crossfade back into the chair.
  await ownerPage.waitForTimeout(500);
  const still = await sampleBones(ownerPage, agentId, 2_000);
  expect(still.keys, JSON.stringify(still)).toEqual([
    expect.stringMatching(/^done\/\w+\/sit_idle\/-$/),
  ]);
  expect(still.frames, JSON.stringify(still)).toBeGreaterThanOrEqual(2);
  expect(still.maxDeg, JSON.stringify(still)).toBeLessThan(0.1);
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

test("6b. the changes window: the owner commits and discards, a member watches (#38)", async () => {
  const dir = worktreePath() ?? "";
  await checkChangesWindow({
    ownerPage,
    memberPage,
    agentId,
    task: TASK,
    openPanel: openHenchmanPanel,
    // As the runner user in the henchman's sandbox, like the henchman's own edits.
    writeInWorktree: (name, content) =>
      void sh("docker", [
        "exec",
        "-w",
        dir,
        sandboxName(),
        "sh",
        "-c",
        'printf %s "$1" > "$2"',
        "sh",
        content,
        name,
      ]),
    worktreeGit,
    worktreeHas: (name) => existsSync(join(dir, name)),
  });
});

test("7. after an office-server restart the henchman and its tmux session are still there", async () => {
  const session = `=agent-${agentId}:`;
  const before = henchmanTmux([
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
    henchmanTmux(["display-message", "-p", "-t", session, "#{pane_pid} #{session_created}"]),
  ).toBe(before);
  for (const page of [ownerPage, memberPage]) {
    await page.goto(OFFICE_PROBE_PATH);
    await waitForScene(page);
    await walkInto(page, OPERATION);
    await expect
      .poll(async () => {
        const r = await henchmanOn(page);
        return r && { status: r.status, seatId: r.seatId, seated: r.seated };
      })
      .toEqual({ status: "done", seatId, seated: true });
  }

  // Its terminal still opens and shows the agent's screen (scrollback over the socket).
  await openHenchmanPanel(ownerPage);
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

test("7b. the henchman's terminal expands, copies a selection and reflows tmux in control (#156)", async () => {
  const windowSize = () =>
    henchmanTmux([
      "display-message",
      "-p",
      "-t",
      `=agent-${agentId}:`,
      "#{window_width}x#{window_height}",
    ]);
  await checkHenchmanTerminal(ownerPage, windowSize, async () => {
    await openHenchmanPanel(ownerPage);
    await ownerPage
      .locator("section.rg-agent-panel")
      .getByRole("button", { name: "Open terminal" })
      .click();
  });
});

test("7c. copying works in the henchman's terminal, on the laptop and in the login terminal (#164)", async () => {
  await checkHenchmanTerminalCopy(
    ownerPage,
    ownerCtx,
    async () => {
      await openHenchmanPanel(ownerPage);
      await ownerPage
        .locator("section.rg-agent-panel")
        .getByRole("button", { name: "Open terminal" })
        .click();
    },
    () => ownerTerminal.text(),
  );
  await checkLaptopCopy(ownerPage, seatId);
  await checkLoginTerminalCopy(ownerPage);
});

test("7d. a member searches the henchman's terminal from the lobby and jumps to its desk (#41)", async () => {
  const page = memberPage;
  await page.bringToFront();
  await walkToLobby(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("/");
  const box = page.getByTestId("search-input");
  await expect(box).toBeFocused();
  const group = page.locator(`[data-group="henchman:${agentId}"]`);
  // Scrollback is snapshotted every 15 s and indexed every 15 s: search again until it is in.
  await expect(async () => {
    await box.fill("");
    await box.fill('"FAKE CLAUDE DONE"');
    await expect(group.getByTestId("search-hit").first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  await expect(group).toContainText(OPERATION);
  await expect(group.locator("mark").first()).toHaveText(/FAKE/);
  await group.getByTestId("search-hit").first().click();

  // Quick travel to the henchman's operation, a walk to its desk, then its terminal at the match.
  await expect(page.locator(".rg-topbar__operation")).toHaveText(OPERATION, { timeout: 20_000 });
  const terminal = page.getByTestId("terminal-modal");
  await expect(terminal).toBeVisible({ timeout: 40_000 });
  const reveal = terminal.getByTestId("search-reveal");
  await expect(reveal.locator("[data-match]")).toContainText("FAKE CLAUDE DONE");
  const gap = await page.evaluate((id) => {
    type V = { x: number; z: number };
    type Obj = { position: V; getWorldPosition(v: V): V };
    const r3f = (
      window as unknown as {
        __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
      }
    ).__regulusR3F;
    const me = r3f?.scene.getObjectByName("local-human");
    const bot = r3f?.scene.getObjectByName(`henchman-${id}`);
    if (!me || !bot) return null;
    const Vec = me.position.constructor as new () => V;
    const a = me.getWorldPosition(new Vec());
    const b = bot.getWorldPosition(new Vec());
    return Math.hypot(a.x - b.x, a.z - b.z);
  }, agentId);
  expect(gap).not.toBeNull();
  expect(gap ?? 99).toBeLessThan(3);
  await reveal.getByRole("button", { name: "Back to live" }).click();
  await expect(reveal).toHaveCount(0);
  await expect(terminal.getByTestId("terminal-mode")).toHaveText("Watching");
  await page.keyboard.press("Escape");
  await expect(terminal).toHaveCount(0);
});

test("7e. the merge gong: the henchman cheers in its chair and sits back exactly as it was (#43)", async () => {
  await checkHenchmanCheers(ownerPage, agentId);
});

test("8. send home frees the desk and deletes the branch as chosen", async () => {
  const ownerPanel = ownerPage.locator("section.rg-agent-panel");
  await openHenchmanPanel(ownerPage);
  const branch = await ownerPanel.locator('[data-key="branch"] dd').innerText();
  await ownerPanel.getByRole("button", { name: "Send home" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Send henchman home" });
  await expect(dialog.getByText(branch)).toBeVisible();
  await dialog.getByLabel(/Delete the branch/).check();
  await dialog.getByRole("button", { name: "Send home" }).click();
  await expect(dialog).toHaveCount(0);

  for (const page of [ownerPage, memberPage]) {
    await expect.poll(() => henchmanOn(page), { timeout: 30_000 }).toBeUndefined();
  }
  // The sandbox and its tmux session are gone, the worktree removed, the branch deleted here
  // and on the remote.
  expect(() => henchmanTmux(["has-session", "-t", `=agent-${agentId}`])).toThrow();
  expect(sh("docker", ["ps", "-aq", "--filter", `name=^${sandboxName()}$`])).toBe("");
  expect(worktreePath()).toBeNull();
  expect(sh("git", ["--git-dir", cloneGitDir, "branch", "--list", branch])).toBe("");
  expect(sh("git", ["--git-dir", bare(), "branch", "--list", branch])).toBe("");

  // The desk is free again: clicking it opens the spawn dialog for that seat.
  await ownerPage.bringToFront();
  await expect.poll(() => scenePoint(ownerPage, `desk-hotspot-${seatId}`)).not.toBeNull();
  const point = await scenePoint(ownerPage, `desk-hotspot-${seatId}`);
  if (!point) throw new Error("desk not in view");
  await ownerPage.mouse.click(point.x, point.y);
  const spawn = ownerPage.getByRole("dialog", { name: "Spawn a henchman" });
  await expect(spawn).toBeVisible();
  await expect(spawn.getByText(seatId)).toBeVisible();
  await spawn.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(spawn).toHaveCount(0);
});

test("9. two queued tasks with concurrency 1 run one after the other, as their owner (#37)", async () => {
  await ownerPage.bringToFront();
  const panel = ownerPage.getByRole("dialog", { name: "Task queue" });
  // The queue clipboard hangs on the wall next to the boards.
  await expect(async () => {
    const point = await scenePoint(ownerPage, "queue-hotspot-queue-clipboard");
    if (!point) throw new Error("queue clipboard not in view");
    await ownerPage.mouse.click(point.x, point.y);
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await panel.getByLabel("Tasks running at once").selectOption("1");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel).toContainText("(1 at once");
  const titles = ["Queued hello one", "Queued hello two"];
  for (const title of titles) {
    await panel.getByRole("button", { name: "Queue a task…" }).click();
    const dialog = ownerPage.getByRole("dialog", { name: "Queue a task" });
    await dialog.getByLabel("Task title").fill(title);
    await dialog.getByLabel(/^Prompt/).fill(`${title}: add a FAKE_CLAUDE.md`);
    await dialog.getByRole("button", { name: "Queue task" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel).toBeVisible();
  }
  const running = panel.getByRole("region", { name: "Running" });
  const queued = panel.getByRole("region", { name: "Queued" });
  await expect(running).toContainText(titles[0] ?? "");
  await expect(queued).toContainText(titles[1] ?? "");
  await expect(queued).toContainText("waiting for a free slot in this room");
  await ownerPage.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // Each henchman is the owner's (their login, their runner): the owner answers its request.
  for (const title of titles) {
    const prompt = ownerPage.getByRole("dialog", { name: "Permission needed" });
    await expect(prompt).toContainText(`“${title}” wants to use`, { timeout: 60_000 });
    await prompt.getByRole("button", { name: "Allow once" }).click();
    await expect(prompt).toHaveCount(0);
  }
  await expect
    .poll(async () => Object.values(await henchmen(ownerPage)).filter((r) => r.status === "done"))
    .toHaveLength(2);
  const point = await scenePoint(ownerPage, "queue-hotspot-queue-clipboard");
  if (!point) throw new Error("queue clipboard not in view");
  await ownerPage.mouse.click(point.x, point.y);
  const recent = panel.getByRole("region", { name: "Recent" });
  for (const title of titles) {
    await expect(recent.locator(".rg-queue__task", { hasText: title })).toContainText("Done");
  }
  await ownerPage.keyboard.press("Escape");
});
