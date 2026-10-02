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
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import { travelInto } from "./compoundProbes.ts";
import { type FakeGitHub, startFakeGitHub } from "./fakeGitHub.ts";
import { pickGenius } from "./geniusChecks.ts";
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

test.describe.configure({ mode: "serial", timeout: 240_000 });

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
  // The picker opens once the office connects, which takes a while on a loaded machine.
  await expect(page.getByRole("dialog", { name: "Choose your genius" })).toBeVisible({
    timeout: 60_000,
  });
  await pickGenius(page, "Mastermind");
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
  const me = (await api(memberPage, "GET", "/api/me")) as { id: string };

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
  await api(ownerPage, "PUT", `/api/operations/${operationId}/members/${me.id}`, {
    access: "view",
  });

  const visible = (await api(memberPage, "GET", "/api/operations")) as {
    operations: { operationId: string; access: string }[];
  };
  expect(visible.operations).toContainEqual(
    expect.objectContaining({ operationId, access: "view" }),
  );
  // Quick travel to the door: software GL on a loaded machine draws few frames to walk with.
  await memberPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(memberPage);
  await travelInto(memberPage, OPERATION);
  await ownerPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(ownerPage);
  await travelInto(ownerPage, OPERATION);
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
  // Wait for the first notes so the transcript has something to show.
  await expect
    .poll(async () => (await meeting(ownerPage)).turns.filter((t) => t.status === "done").length, {
      timeout: 120_000,
    })
    .toBeGreaterThan(0);
  const live = ownerPage.getByRole("dialog", { name: "Meeting" });
  await expect(live.getByText("Proposer (fake, not Claude Code)", { exact: false })).toBeVisible();
  await expect(live.getByRole("button", { name: "Pause" })).toBeVisible();
  await shoot(ownerPage, "meeting-panel");
  await live.getByRole("button", { name: "Close" }).first().click();
  await expect(live).toHaveCount(0);
  await shoot(ownerPage, "room-during-meeting");

  await memberPage.bringToFront();
  const rooms = memberPage.getByRole("navigation", { name: "Rooms" });
  await rooms.getByRole("button", { name: "Meeting in session…" }).click();
  const watch = memberPage.getByRole("dialog", { name: "Meeting" });
  await expect(watch.getByText("Proposer (fake, not Claude Code)", { exact: false })).toBeVisible();
  await expect(watch.getByRole("button", { name: "Pause" })).toHaveCount(0);
  await expect(watch.getByRole("button", { name: /stop/i })).toHaveCount(0);
  const refused = await memberPage.request.post(`/api/meetings/${meetingId}/stop`, {
    headers: { origin: office.baseURL },
  });
  expect(refused.status()).toBe(403);
});

test("the meeting ends in a draft PR from the shared worktree; the henchmen go home", async () => {
  await ownerPage.bringToFront();
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
