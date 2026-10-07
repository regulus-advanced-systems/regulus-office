/**
 * The meeting room end to end (#50, SPEC §10 M3): an owner calls a debate of three Claude Code
 * henchmen from the Rooms panel; the office spawns them as the owner, in the owner's runner,
 * at one desk pod; a hologram over the pod and a sign over the door show the meeting; they take
 * turns in a shared worktree (the fake `claude` in tests/e2e/runner writes each turn's notes and
 * the closer commits); a member with view access watches the transcript without controls; the
 * meeting ends in a draft PR on the fake GitHub, with the notes kept out of git, and the
 * henchmen go home.
 *
 * Runs with the agents suite (`bun run e2e:agents`, needs Docker): the same production office
 * harness (tests/e2e/agentOffice.ts) and test runner image. With E2E_SCREENSHOTS_DIR set, it
 * saves the meeting UI and the room during the meeting by day and by night there.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type { MeetingDetail } from "@regulus/protocol";
import { collectAgentDiagnostics } from "./agentDiagnostics.ts";
import {
  AgentOffice,
  buildRunnerImage,
  cleanupRunners,
  dockerAvailable,
  sh,
} from "./agentOffice.ts";
import { henchmen, scenePoint } from "./agentProbes.ts";
import { navPose, roomNamed, walkTo, walkToSeat, wheelZoomTo } from "./compoundProbes.ts";
import { type FakeGitHub, MEMBER_GITHUB, OWNER_GITHUB, startFakeGitHub } from "./fakeGitHub.ts";
import { linkGitHub, setRepoPermission } from "./githubAccess.ts";
import { createRemoteRepo } from "./gitRemote.ts";
import { OFFICE_PROBE_PATH, waitForScene } from "./probes.ts";

const run = Date.now().toString(36);
const owner = {
  name: "Ada Owner",
  email: `m-owner-${run}@example.com`,
  password: `owner-pw-${run}`,
};
const member = {
  name: "Ben Member",
  email: `m-member-${run}@example.com`,
  password: `member-pw-${run}`,
};
const REPO = { owner: "octo", name: "council", branch: "trunk" };
const OPERATION = "War Council";
const TOPIC = "Pick a cache for the board sync";
/** The operation repo's own PAT (the project credential); only ever sent to the fake GitHub. */
const REPO_TOKEN = `github_pat_e2eMeetingRepoToken${run}`;
const SHOTS = process.env.E2E_SCREENSHOTS_DIR;

test.describe.configure({ mode: "serial", timeout: 480_000 });

let dataDir = "";
let prefix = "";
let github: FakeGitHub;
let office: AgentOffice;
let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let ownerPage: Page;
let memberPage: Page;
let operationId = "";
let meetingId = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  if (!dockerAvailable()) {
    if (process.env.CI) throw new Error("the meetings e2e needs a Docker daemon");
    test.skip(true, "needs a Docker daemon (docker runner backend)");
  }
  buildRunnerImage();
  dataDir = mkdtempSync(join(tmpdir(), "regulus-e2e-meetings-"));
  prefix = `${process.env.E2E_RUNNER_PREFIX ?? "rge2e"}-m${run}`;
  github = await startFakeGitHub({ orgToken: `github_pat_unused${run}`, repos: [] });
  office = new AgentOffice({
    dataDir,
    port: Number(process.env.E2E_MEETINGS_PORT ?? 4630),
    githubApiBase: github.url,
    prefix,
  });
  createRemoteRepo(dataDir, REPO.owner, REPO.name, REPO.branch);
  await office.start();
  ownerCtx = await browser.newContext({ baseURL: office.baseURL });
  memberCtx = await browser.newContext({ baseURL: office.baseURL });
  ownerPage = await ownerCtx.newPage();
  memberPage = await memberCtx.newPage();
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && office) {
    collectAgentDiagnostics(testInfo.outputPath("diagnostics"), {
      prefix,
      serverLog: office.log(),
    });
  }
});

test.afterAll(async () => {
  await ownerCtx?.close();
  await memberCtx?.close();
  await office?.close();
  if (prefix) cleanupRunners(prefix);
  await github?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function register(page: Page, who: typeof owner, submit: string): Promise<void> {
  await page.getByLabel("Display name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByLabel("Confirm password").fill(who.password);
  await page.getByRole("button", { name: submit }).click();
  await expect(page).toHaveURL(/\/office/);
  // The first-login genius picker (#185), with room for a loaded machine: it opens once the
  // office connects and closes once the choice is saved.
  const picker = page.getByRole("dialog", { name: "Choose your genius" });
  await expect(picker).toBeVisible({ timeout: 60_000 });
  await picker.getByText("Mastermind", { exact: true }).click();
  await picker.getByRole("button", { name: "Enter the lair" }).click();
  await expect(picker).toBeHidden({ timeout: 60_000 });
}

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

/** The meeting's shared worktree (`<worktrees>/<operation>/<runner id>/<meetingId>`), once made. */
function meetingWorktree(): string | null {
  const root = office.worktreesDir;
  for (const operation of readdirSync(root)) {
    for (const area of readdirSync(join(root, operation))) {
      const dir = join(root, operation, area, meetingId);
      if (existsSync(dir)) return dir;
    }
  }
  return null;
}

/** While `.meeting/hold` exists the fake's closing turn waits (tests/e2e/runner/claude). */
function holdTheFloor(hold: boolean): void {
  const dir = meetingWorktree();
  if (!dir) throw new Error("no meeting worktree");
  const file = join(dir, ".meeting", "hold");
  if (hold) {
    mkdirSync(join(dir, ".meeting"), { recursive: true });
    writeFileSync(file, "the spec is watching\n");
  } else {
    rmSync(file, { force: true });
  }
}

/**
 * Quick travel (`F`) to the room's door and step in. Unlike `travelInto` it does not walk on to
 * the middle: software GL on a loaded machine draws so few frames that the walk can take minutes.
 */
async function enter(page: Page, name: string): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("f");
  const travel = page.getByRole("dialog", { name: "Quick travel" });
  await travel
    .getByRole("list", { name: "Rooms you can enter" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  await expect(travel).toHaveCount(0);
  const room = await roomNamed(page, name);
  await expect(async () => {
    const pose = await navPose(page);
    if (pose.room === room.id && pose.operationId === room.id) return;
    if (!pose.walking) expect(await walkTo(page, room.inside.x, room.inside.z)).toBe(true);
    throw new Error(`walking into ${name}`);
  }).toPass({ timeout: 180_000, intervals: [500, 1_000] });
  await expect(page.locator(".rg-topbar__operation")).toHaveText(name, { timeout: 60_000 });
}

const meeting = async (page: Page) =>
  (await api(page, "GET", `/api/meetings/${meetingId}`)) as MeetingDetail;

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(SHOTS, `${name}-${scheme === "light" ? "day" : "night"}.jpg`),
      quality: 80,
      type: "jpeg",
    });
  }
  await page.emulateMedia({ colorScheme: null });
}

test("the owner and a member sign in; the owner adds the operation and lets the member watch", async () => {
  await ownerPage.goto("/login");
  await register(ownerPage, owner, "Create the owner account");
  const invite = (await api(ownerPage, "POST", "/api/invites", { role: "member" })) as {
    url: string;
  };
  await memberPage.goto(invite.url);
  await register(memberPage, member, "Create account and join");
  // Rooms open with each person's own GitHub access (#270): the owner administers the repo
  // there, the member may read it and so watch in its room.
  await setRepoPermission(github.url, MEMBER_GITHUB, `${REPO.owner}/${REPO.name}`, "read");
  await linkGitHub(ownerPage, OWNER_GITHUB);
  await linkGitHub(memberPage, MEMBER_GITHUB);

  const created = (await api(ownerPage, "POST", "/api/operations", {
    name: OPERATION,
    tier: "small",
    repos: [{ repo: `${REPO.owner}/${REPO.name}`, token: REPO_TOKEN }],
  })) as { operationId: string };
  operationId = created.operationId;
  await expect
    .poll(async () => {
      const op = (await api(ownerPage, "GET", `/api/operations/${operationId}`)) as {
        repos: { cloneStatus: string }[];
      };
      return op.repos[0]?.cloneStatus;
    })
    .toBe("ready");
  // Creating the room refreshed everyone's GitHub snapshot for its repo.
  await expect
    .poll(async () => {
      const list = (await api(memberPage, "GET", "/api/operations")) as {
        operations: { operationId: string; access: string }[];
      };
      return list.operations.find((o) => o.operationId === operationId)?.access;
    })
    .toBe("view");
  const visible = (await api(memberPage, "GET", "/api/operations")) as {
    operations: { operationId: string; access: string }[];
  };
  expect(visible.operations).toContainEqual(
    expect.objectContaining({ operationId, access: "view" }),
  );
  // Quick travel to the door: software GL on a loaded machine draws few frames to walk with.
  await memberPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(memberPage);
  await enter(memberPage, OPERATION);
  await ownerPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(ownerPage);
  await enter(ownerPage, OPERATION);
});

test("the owner calls a debate of three henchmen from the Rooms panel", async () => {
  await ownerPage.bringToFront();
  const rooms = ownerPage.getByRole("navigation", { name: "Rooms" });
  await rooms.getByRole("button", { name: "Meeting room…" }).click();
  const panel = ownerPage.getByRole("dialog", { name: "Meeting room" });
  await panel.getByRole("button", { name: "Call a meeting…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Call a meeting" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Task" }).fill(TOPIC);
  await dialog.getByRole("button", { name: "Add a henchman" }).click();
  for (const role of ["Proposer", "Challenger", "Judge"]) {
    await dialog.getByLabel(`${role}'s model`).selectOption("claude-code|opus");
  }
  await dialog.getByLabel("Rounds").fill("1");
  await expect(
    dialog.getByText("Round 1: Proposer opens → Challenger opens → Judge closes"),
  ).toBeVisible();
  await shoot(ownerPage, "start-dialog");
  await dialog.getByRole("button", { name: "Start meeting" }).click();

  const live = ownerPage.getByRole("dialog", { name: "Meeting" });
  await expect(live.getByText(TOPIC)).toBeVisible();
  const summary = (await api(ownerPage, "GET", `/api/meetings?operationId=${operationId}`)) as {
    meetings: { id: string }[];
  };
  meetingId = summary.meetings[0]?.id ?? "";
  expect(meetingId).not.toBe("");
  // Keep the closing turn waiting while the next step watches the meeting in session.
  await expect.poll(() => meetingWorktree(), { timeout: 60_000 }).not.toBeNull();
  holdTheFloor(true);
  // Three henchmen of the owner sit down at one pod.
  await expect
    .poll(async () => Object.values(await henchmen(ownerPage)).length, { timeout: 120_000 })
    .toBe(3);
  await expect
    .poll(async () => (await meeting(ownerPage)).status, { timeout: 60_000 })
    .toBe("running");
});

test("the room shows the meeting; a member watches the transcript without controls", async () => {
  // The hologram over the pod and the sign over the door.
  await expect
    .poll(() => scenePoint(ownerPage, "meeting-hologram"), { timeout: 30_000 })
    .not.toBeNull();
  await expect.poll(() => scenePoint(ownerPage, `meeting-door-sign-${operationId}`)).not.toBeNull();
  // Proposer and Challenger have spoken; the Judge has the floor (held, see holdTheFloor).
  await expect
    .poll(async () => (await meeting(ownerPage)).turns.map((t) => t.status).join(","), {
      timeout: 120_000,
    })
    .toBe("done,done,running");
  const live = ownerPage.getByRole("dialog", { name: "Meeting" });
  // Earlier turns fold away under the latest one; their notes are in the transcript.
  await expect(live.locator(".rg-meeting__turn").first()).toContainText(
    "Proposer (fake, not Claude Code)",
  );
  await expect(live.getByRole("button", { name: "Pause" })).toBeVisible();
  await shoot(ownerPage, "meeting-panel");
  await live.getByRole("button", { name: "Close" }).first().click();
  await expect(live).toHaveCount(0);
  if (SHOTS) {
    // Up to the pod and closer in, so the pictures show the hologram and who has the floor.
    const judge = (await meeting(ownerPage)).members[2]?.seatId ?? "";
    if (await walkToSeat(ownerPage, operationId, judge)) {
      await expect
        .poll(async () => (await navPose(ownerPage)).walking, { timeout: 120_000 })
        .toBe(false);
    }
    await wheelZoomTo(ownerPage, 0.3);
  }
  await shoot(ownerPage, "room-during-meeting");

  await memberPage.bringToFront();
  const rooms = memberPage.getByRole("navigation", { name: "Rooms" });
  const inSession = rooms.getByRole("button", { name: "Meeting in session…" });
  await expect(inSession).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => scenePoint(memberPage, `meeting-door-sign-${operationId}`))
    .not.toBeNull();
  if (SHOTS) {
    // The member stands just inside the door: the sign over it and the pod behind.
    await wheelZoomTo(memberPage, 0.35);
    await shoot(memberPage, "door-sign");
  }
  await inSession.click();
  const watch = memberPage.getByRole("dialog", { name: "Meeting" });
  await expect(watch.locator(".rg-meeting__turn").first()).toContainText(
    "Proposer (fake, not Claude Code)",
  );
  await expect(watch.getByRole("button", { name: "Pause" })).toHaveCount(0);
  await expect(watch.getByRole("button", { name: /stop/i })).toHaveCount(0);
  const refused = await memberPage.request.post(`/api/meetings/${meetingId}/stop`, {
    headers: { origin: office.baseURL },
  });
  expect(refused.status()).toBe(403);
});

test("the meeting ends in a draft PR from the shared worktree; the henchmen go home", async () => {
  await ownerPage.bringToFront();
  holdTheFloor(false);
  await expect
    .poll(async () => (await meeting(ownerPage)).status, { timeout: 180_000 })
    .toBe("done");
  const done = await meeting(ownerPage);
  expect(done.reason).toBe("opened draft pull request #1");
  expect(done.turns.map((t) => t.status)).toEqual(["done", "done", "done"]);
  expect(done.turns[2]?.text).toContain("Judge (fake, not Claude Code)");
  const pr = github.requests.find((r) => r.method === "POST" && r.path.endsWith("/pulls"));
  expect(pr?.body).toMatchObject({ head: done.branch, base: REPO.branch, draft: true });
  // The branch reached the remote with the closer's commit and without the notes.
  const bare = join(dataDir, "remotes", REPO.owner, `${REPO.name}.git`);
  const files = sh("git", ["--git-dir", bare, "ls-tree", "-r", "--name-only", done.branch]).split(
    "\n",
  );
  expect(files).toContain("MEETING_CACHE.ts");
  expect(files.some((f) => f.startsWith(".meeting"))).toBe(false);
  await expect
    .poll(async () => Object.values(await henchmen(ownerPage)).length, { timeout: 60_000 })
    .toBe(0);
});
