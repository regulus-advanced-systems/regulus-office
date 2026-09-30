/**
 * M0 smoke test (docs/SPEC.md §10 M0 exit criteria): the owner registers,
 * mints an invite in the UI, a second browser joins through the link, both
 * reach /office and see each other, one walks and the other sees it move,
 * chat crosses between them and `/` search finds it (#41), the first-person view toggles on V and back,
 * the owner's robot turns to follow the mouse and walks face-first to a click,
 * the owner adds a floor bound to a (local) repo and rides to it, Floor
 * settings and Add floor fit a 1280×720 window with the round X in view
 * (#149), clicking a free desk there opens the spawn dialog, whose agent.spawn gets
 * an answer from the server (no agent CLI runs in e2e), and a second floor
 * is archived, restored and deleted for good, files included (#150). Last, with a (fake) org
 * token connected, the issue board fills from GitHub, a card is opened and carried to a free
 * desk, and the spawn dialog opens prefilled from it (#36).
 *
 * Runs against office-server in production mode (see playwright.config.ts),
 * so room joins are authorised by the Better Auth session cookie only.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { insideViewport, settledDialogLayout } from "./dialogLayout.ts";
import { type FakeGitHub, startFakeGitHub } from "./fakeGitHub.ts";
import { createRemoteRepo } from "./gitRemote.ts";
import {
  angleBetween,
  boardPoint,
  cameraType,
  carriedCardsInScene,
  distance,
  floorSize,
  freeDeskPoint,
  groundUnder,
  headingToward,
  humans,
  localPose,
  OFFICE_PROBE_PATH,
  remoteHumans,
  sampleLocalPoses,
  screenPointOf,
  waitForScene,
} from "./probes.ts";

const run = Date.now().toString(36);
const owner = { name: "Ada Owner", email: `owner-${run}@example.com`, password: `owner-pw-${run}` };
const member = {
  name: "Ben Member",
  email: `member-${run}@example.com`,
  password: `member-pw-${run}`,
};

test.describe.configure({ mode: "serial" });

let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let ownerPage: Page;
let memberPage: Page;
let inviteUrl = "";
/** The desk the spawn step used. */
let spawnSeat = "";

test.beforeAll(async ({ browser }) => {
  ownerCtx = await browser.newContext();
  memberCtx = await browser.newContext();
  ownerPage = await ownerCtx.newPage();
  memberPage = await memberCtx.newPage();
});

test.afterAll(async () => {
  await ownerCtx?.close();
  await memberCtx?.close();
});

async function register(page: Page, who: typeof owner, submit: string): Promise<void> {
  await page.getByLabel("Display name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByLabel("Confirm password").fill(who.password);
  await page.getByRole("button", { name: submit }).click();
  await expect(page).toHaveURL(/\/office/);
}

test("the first account becomes the owner", async () => {
  await ownerPage.goto("/login");
  await expect(ownerPage.getByRole("heading", { name: "Set up your office" })).toBeVisible();
  await register(ownerPage, owner, "Create the owner account");
  const me = await ownerPage.request.get("/api/me");
  expect(await me.json()).toMatchObject({ displayName: owner.name, role: "owner" });
});

test("the owner creates an invite link in the UI", async () => {
  await ownerPage.getByRole("button", { name: "Settings" }).click();
  await ownerPage.getByRole("button", { name: "Invite someone…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByRole("button", { name: "Create invite link" }).click();
  const link = dialog.getByLabel(/Invite link for member/);
  await expect(link).toHaveValue(/\/join\/[\w-]+$/);
  inviteUrl = await link.inputValue();
  expect(new URL(inviteUrl).origin).toBe(new URL(ownerPage.url()).origin);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
});

test("a second browser joins through the invite", async () => {
  await memberPage.goto(inviteUrl);
  await expect(memberPage.getByRole("heading", { name: "You're invited" })).toBeVisible();
  await register(memberPage, member, "Create account and join");
  const me = await memberPage.request.get("/api/me");
  expect(await me.json()).toMatchObject({ displayName: member.name, role: "member" });
});

test("both reach the office and see each other's avatar", async () => {
  await ownerPage.goto(OFFICE_PROBE_PATH);
  await memberPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(ownerPage);
  await waitForScene(memberPage);
  await expect.poll(() => remoteHumans(ownerPage)).toHaveLength(1);
  await expect.poll(() => remoteHumans(memberPage)).toHaveLength(1);
});

test("the member sees the owner walk", async () => {
  const [ownerOnMember] = await remoteHumans(memberPage);
  if (!ownerOnMember) throw new Error("owner avatar missing on the member's page");
  const before = (await humans(memberPage))[ownerOnMember];
  const selfBefore = (await humans(ownerPage))["local-human"];
  if (!before || !selfBefore) throw new Error("positions missing");

  // WASD walk; D is screen-right in the isometric view, away from the spawn wall.
  await ownerPage.bringToFront();
  await ownerPage.locator("canvas").first().hover();
  for (const key of ["d", "s"]) {
    await ownerPage.keyboard.down(key);
    await ownerPage.waitForTimeout(700);
    await ownerPage.keyboard.up(key);
  }

  await expect
    .poll(async () => {
      const self = (await humans(ownerPage))["local-human"];
      return self ? distance(self, selfBefore) : 0;
    })
    .toBeGreaterThan(0.5);
  await expect
    .poll(async () => {
      const seen = (await humans(memberPage))[ownerOnMember];
      return seen ? distance(seen, before) : 0;
    })
    .toBeGreaterThan(0.5);
  // Once settled, the member's copy ends where the owner actually stopped.
  await expect
    .poll(async () => {
      const self = (await humans(ownerPage))["local-human"];
      const seen = (await humans(memberPage))[ownerOnMember];
      return self && seen ? distance(self, seen) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(0.3);
});

test("chat from one browser arrives in the other", async () => {
  const text = `hello from the owner ${run}`;
  const input = ownerPage.getByTestId("chat-input");
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(
    ownerPage.getByTestId("chat-log").locator("li.rg-chat__line--own", { hasText: text }),
  ).toBeVisible();
  await expect(
    memberPage.getByTestId("chat-log").locator("li.rg-chat__line", { hasText: text }),
  ).toBeVisible();

  const reply = `hi back ${run}`;
  const memberInput = memberPage.getByTestId("chat-input");
  await memberInput.fill(reply);
  await memberInput.press("Enter");
  await expect(
    ownerPage.getByTestId("chat-log").locator("li.rg-chat__line", { hasText: reply }),
  ).toBeVisible();
  await input.press("Escape");
  await memberInput.press("Escape");
});

test("/ opens search; chat is found, highlighted, for everyone who saw it (#41)", async () => {
  const word = `zephyr${run}`;
  const input = ownerPage.getByTestId("chat-input");
  await input.fill(`the ${word} deploy is green`);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await input.press("Escape");
  for (const page of [ownerPage, memberPage]) {
    await page.bringToFront();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("/");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    const box = page.getByTestId("search-input");
    await expect(box).toBeFocused();
    // Typed the way people do, including FTS5 syntax that must stay plain text.
    await box.pressSequentially(`${word} OR "`);
    await box.fill(word.slice(0, -2));
    const group = page.locator('[data-group="chat:lobby"]');
    await expect(group).toContainText("Chat · Lobby");
    const hit = group.getByTestId("search-hit").filter({ hasText: `the ${word} deploy` });
    await expect(hit).toBeVisible();
    await expect(hit.locator("mark")).toHaveText(word);
    await box.fill(`${word} "no such phrase anywhere"`);
    await expect(page.getByTestId("search-status")).toHaveText("No matches you can see.");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("the status box unfolds the viewer's own usage (#40)", async () => {
  const status = ownerPage.getByRole("region", { name: "Status" });
  await status.getByRole("button", { name: "Usage", exact: true }).click();
  const panel = ownerPage.getByRole("region", { name: "Usage", exact: true });
  await expect(panel).toContainText("Your plan windows");
  await expect(panel).toContainText("No plan windows reported yet.");
  await expect(panel).toContainText("Office today");
  const res = await ownerPage.request.get("/api/usage/me?tz=0");
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { limits: unknown[] }).limits).toEqual([]);
  await status.getByRole("button", { name: "Hide usage", exact: true }).click();
  await expect(panel).toBeHidden();
});

test("V toggles the first-person view and back", async () => {
  await ownerPage.bringToFront();
  const toggle = ownerPage.getByRole("button", { name: /First person/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await cameraType(ownerPage)).toBe("OrthographicCamera");

  await ownerPage.keyboard.press("v");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => cameraType(ownerPage)).toBe("PerspectiveCamera");
  // #144: the projection matches the canvas (it once stayed at aspect 1).
  const projection = await ownerPage.evaluate(() => {
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          get(): {
            camera: { aspect?: number; fov?: number };
            size: { width: number; height: number };
          };
        };
      }
    ).__regulusR3F;
    const s = r3f?.get();
    return s
      ? { aspect: s.camera.aspect, fov: s.camera.fov, canvas: s.size.width / s.size.height }
      : null;
  });
  expect(projection?.aspect).toBeCloseTo(projection?.canvas ?? 0, 3);
  expect(projection?.fov).toBe(60);

  await ownerPage.keyboard.press("v");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => cameraType(ownerPage)).toBe("OrthographicCamera");
});

test("the robot turns to follow the cursor and walks face-first to a click", async () => {
  await ownerPage.bringToFront();
  const start = await localPose(ownerPage);
  const at = start && (await screenPointOf(ownerPage, start));
  if (!start || !at) throw new Error("local robot missing");

  /** Point the mouse at a viewport spot; the standing robot ends up facing the floor under it. */
  const faceCursorAt = async (x: number, y: number) => {
    await ownerPage.mouse.move(x, y, { steps: 4 });
    const ground = await groundUnder(ownerPage, x, y);
    const self = await localPose(ownerPage);
    if (!ground || !self) throw new Error("cursor ground point or robot missing");
    const want = headingToward(self, ground);
    await expect
      .poll(async () => angleBetween((await localPose(ownerPage))?.heading ?? Number.NaN, want))
      .toBeLessThan(0.05);
    return want;
  };

  // Sweep the cursor around the robot: the heading follows it.
  const right = await faceCursorAt(at.x + 180, at.y + 60);
  const left = await faceCursorAt(at.x - 180, at.y + 60);
  expect(angleBetween(right, left)).toBeGreaterThan(0.5);

  // Over a HUD panel the cursor is ignored: the heading holds.
  const settled = (await localPose(ownerPage))?.heading ?? Number.NaN;
  const settings = await ownerPage.getByRole("button", { name: "Settings" }).boundingBox();
  if (!settings) throw new Error("Settings button missing");
  await ownerPage.mouse.move(settings.x + settings.width / 2, settings.y + settings.height / 2);
  await ownerPage.waitForTimeout(400);
  expect((await localPose(ownerPage))?.heading).toBeCloseTo(settled, 5);

  // Click the middle of the floor: the robot walks there, facing where it goes.
  const size = (await floorSize(ownerPage))?.split("x").map(Number);
  if (!size || size.length !== 2) throw new Error("floor size missing");
  const target = { x: (size[0] ?? 0) / 2, z: (size[1] ?? 0) / 2 };
  const click = await screenPointOf(ownerPage, target);
  if (!click) throw new Error("target not on screen");
  await ownerPage.mouse.click(click.x, click.y);
  const samples = await sampleLocalPoses(ownerPage, 1500);
  const steps = samples.slice(1).flatMap((p, i) => {
    const prev = samples[i];
    if (!prev || distance(p, prev) < 0.01) return [];
    return [angleBetween(p.heading, headingToward(prev, p))];
  });
  expect(steps.length).toBeGreaterThan(5);
  // Never walks more than 45 degrees off its travel (turns on the spot first) and mostly dead on.
  expect(Math.max(...steps)).toBeLessThan(Math.PI / 4 + 0.15);
  expect(steps.filter((d) => d < 0.2).length / steps.length).toBeGreaterThan(0.8);
  await expect
    .poll(async () => {
      const self = await localPose(ownerPage);
      return self ? distance(self, target) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(0.75);

  // Standing again, it turns back toward the cursor.
  const there = await screenPointOf(ownerPage, target);
  if (!there) throw new Error("robot not on screen");
  await faceCursorAt(there.x, there.y - 160);
});

test("the owner adds a floor from a repo and rides the elevator to it and back", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  createRemoteRepo(process.env.E2E_DATA_DIR ?? "", "octo", "hello");
  await ownerPage.bringToFront();
  const lobbySize = await floorSize(ownerPage);
  const elevator = ownerPage.getByRole("navigation", { name: "Elevator" });
  await elevator.getByRole("button", { name: "Add floor…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Add floor" });
  await dialog.getByLabel("Floor name").fill("Apollo");
  await dialog.getByLabel("Repo 1", { exact: true }).fill("octo/hello");
  await dialog.getByRole("button", { name: "Create floor" }).click();
  const added = ownerPage.getByRole("dialog", { name: "Floor added" });
  await expect(added.getByText("Ready on trunk")).toBeVisible();
  await added.getByRole("button", { name: "Go to floor" }).click();

  await expect(ownerPage.locator(".rg-topbar__floor")).toHaveText("Apollo");
  await expect(elevator.getByRole("button", { name: /1\. Apollo/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect.poll(() => floorSize(ownerPage)).not.toBe(lobbySize);
  // The member has no access to the new floor and no longer sees the owner.
  const memberElevator = memberPage.getByRole("navigation", { name: "Elevator" });
  await expect(memberElevator.getByRole("button", { name: /Apollo/ })).toHaveCount(0);
  await expect.poll(() => remoteHumans(memberPage)).toHaveLength(0);

  await elevator.getByRole("button", { name: /0\. Lobby/ }).click();
  await expect(ownerPage.locator(".rg-topbar__floor")).toHaveText("Lobby");
  await expect.poll(() => floorSize(ownerPage)).toBe(lobbySize);
  await expect.poll(() => remoteHumans(memberPage)).toHaveLength(1);
});

test("Floor settings and Add floor fit a 1280×720 window with the X in view", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the floor from the previous step");
  await ownerPage.bringToFront();
  await ownerPage.setViewportSize({ width: 1280, height: 720 });
  const elevator = ownerPage.getByRole("navigation", { name: "Elevator" });
  const dialogs = [
    {
      name: "Floor settings",
      opener: elevator.getByRole("button", { name: "Floor settings: Apollo" }),
    },
    { name: "Add floor", opener: elevator.getByRole("button", { name: "Add floor…" }) },
  ];
  for (const { name, opener } of dialogs) {
    await opener.click();
    const dialog = ownerPage.getByRole("dialog", { name });
    const layout = await settledDialogLayout(ownerPage, dialog);
    expect(insideViewport(layout), `${name}: X inside the viewport`).toBe(true);
    expect(layout.closeHittable, `${name}: X not clipped or covered`).toBe(true);
    expect(layout.horizontalOverflow, `${name}: no horizontal scrollbar`).toEqual([]);
    expect(layout.frameScrolls, `${name}: only the body scrolls`).toBe(false);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await ownerPage.setViewportSize({ width: 1280, height: 800 });
});

test("clicking a free desk opens the spawn dialog and the server answers agent.spawn", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the floor from the previous step");
  await ownerPage.bringToFront();
  const elevator = ownerPage.getByRole("navigation", { name: "Elevator" });
  await elevator.getByRole("button", { name: /1\. Apollo/ }).click();
  await expect(ownerPage.locator(".rg-topbar__floor")).toHaveText("Apollo");
  // The floor HUD counters appear once the FloorRoom state is in.
  await expect(ownerPage.getByRole("list", { name: "Work on this floor" })).toBeVisible();

  await expect.poll(() => freeDeskPoint(ownerPage)).not.toBeNull();
  const desk = await freeDeskPoint(ownerPage);
  if (!desk) throw new Error("no free desk in the scene");
  // A runner may take the spawn (the robot then sits there); the board step picks another desk.
  spawnSeat = desk.seatId;
  await ownerPage.mouse.click(desk.x, desk.y);
  const dialog = ownerPage.getByRole("dialog", { name: "Spawn a robot" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(desk.seatId)).toBeVisible();
  // Repo preselected, model and effort defaulted: Spawn right away, with no prompt (#142).
  await expect(dialog.getByRole("radio", { name: "Opus" })).toBeChecked();
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Spawn robot" }).click();
  // Without an agent CLI in the e2e server the spawn is refused (shown in the
  // dialog), unless a runner took it, in which case the robot sits down.
  await expect(dialog.getByRole("alert").or(ownerPage.getByText("Robot spawned"))).toBeVisible({
    timeout: 30_000,
  });
  if (await dialog.isVisible())
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("the owner archives, restores and deletes a floor; its files go with it", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  const dataDir = process.env.E2E_DATA_DIR ?? "";
  await ownerPage.bringToFront();
  const elevator = ownerPage.getByRole("navigation", { name: "Elevator" });
  await elevator.getByRole("button", { name: "Add floor…" }).click();
  const create = ownerPage.getByRole("dialog", { name: "Add floor" });
  await create.getByLabel("Floor name").fill("Hermes");
  await create.getByLabel("Repo 1", { exact: true }).fill("octo/hello");
  await create.getByRole("button", { name: "Create floor" }).click();
  const added = ownerPage.getByRole("dialog", { name: "Floor added" });
  await expect(added.getByText("Ready on trunk")).toBeVisible();
  await added.getByRole("button", { name: "Done" }).click();
  const hermes = elevator.getByRole("button", { name: /\d+\. Hermes/ });
  await expect(hermes).toBeVisible();
  const mirror = join(dataDir, "projects", "hermes");
  expect(existsSync(join(mirror, "hello", ".git"))).toBe(true);
  // A human's area on the floor, as a spawn would leave it.
  const area = join(dataDir, "worktrees", "hermes", "u1", "_clones", "hello");
  mkdirSync(area, { recursive: true });
  writeFileSync(join(area, "work.txt"), "work\n");

  // Archive from the Danger zone of Floor settings: gone from the elevator, files kept.
  const settings = ownerPage.getByRole("dialog", { name: "Floor settings" });
  await elevator.getByRole("button", { name: "Floor settings: Hermes" }).click();
  await settings.getByRole("button", { name: "Archive floor" }).click();
  await expect(settings).toBeHidden();
  await expect(hermes).toHaveCount(0);
  expect(existsSync(mirror)).toBe(true);

  // Restore from Settings → Floors.
  await ownerPage.getByRole("button", { name: "Settings", exact: true }).click();
  const panel = ownerPage.getByRole("dialog", { name: "Settings", exact: true });
  await expect(panel.getByRole("list", { name: "Archived floors" })).toContainText("Hermes");
  await panel.getByRole("button", { name: "Restore Hermes" }).click();
  await expect(panel.getByText("Hermes is back in the elevator.")).toBeVisible();
  await ownerPage.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(hermes).toBeVisible();

  // Delete for good, after typing the name.
  await elevator.getByRole("button", { name: "Floor settings: Hermes" }).click();
  await settings.getByRole("button", { name: "Delete floor…" }).click();
  const confirm = settings.getByRole("button", { name: "Delete floor", exact: true });
  await expect(confirm).toBeDisabled();
  await settings.getByLabel("Type the floor name to confirm").fill("Hermes");
  await confirm.click();
  await expect(settings).toBeHidden();
  await expect(hermes).toHaveCount(0);
  // The dialog closes as soon as the floor is archived (step one of the delete).
  await expect.poll(() => existsSync(mirror)).toBe(false);
  await expect.poll(() => existsSync(join(dataDir, "worktrees", "hermes"))).toBe(false);
  // The other floor is untouched.
  expect(existsSync(join(dataDir, "projects", "apollo", "hello", ".git"))).toBe(true);
  await expect(elevator.getByRole("button", { name: /1\. Apollo/ })).toBeVisible();
});

test("a card from the issue board carried to a free desk opens the spawn dialog prefilled", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server and its fake GitHub");
  const orgToken = "github_pat_E2Eboards_0123456789abcdefghij";
  const issue = {
    number: 7,
    title: "Fix the lift doors",
    state: "open",
    labels: [{ name: "bug" }],
    assignees: [],
    user: { login: "olga" },
    html_url: "https://github.com/octo/hello/issues/7",
    body: "The doors stick.\n\n- [ ] oil them\n\n<script>alert(1)</script>",
    updated_at: new Date().toISOString(),
  };
  const pull = {
    ...issue,
    number: 8,
    title: "Oil the lift doors",
    body: "Fixes #7",
    html_url: "https://github.com/octo/hello/pull/8",
    draft: false,
    merged_at: null,
    requested_reviewers: [{ login: "olga" }],
    requested_teams: [],
    head: { ref: "office/oil", sha: "e2e8" },
    base: { ref: "trunk" },
  };
  let gh: FakeGitHub | undefined;
  try {
    gh = await startFakeGitHub(
      { orgToken, repos: [{ owner: "octo", name: "hello", defaultBranch: "trunk" }] },
      {
        port: Number(process.env.E2E_GITHUB_PORT),
        boards: { "octo/hello": { issues: [issue], pulls: [pull] } },
      },
    );
    await ownerPage.bringToFront();
    const origin = new URL(ownerPage.url()).origin;
    const connect = await ownerPage.request.put("/api/github/pat", {
      data: { token: orgToken },
      headers: { origin },
    });
    expect(connect.status()).toBe(200);

    const elevator = ownerPage.getByRole("navigation", { name: "Elevator" });
    await elevator.getByRole("button", { name: /1\. Apollo/ }).click();
    await expect(ownerPage.locator(".rg-topbar__floor")).toHaveText("Apollo");
    await expect.poll(() => boardPoint(ownerPage, "issue-board")).not.toBeNull();
    const board = await boardPoint(ownerPage, "issue-board");
    if (!board) throw new Error("issue board missing from the scene");
    await ownerPage.mouse.click(board.x, board.y);
    const panel = ownerPage.getByRole("dialog", { name: "Issue board" });
    await expect(panel).toBeVisible();
    // The poller fills the board from the fake GitHub shortly after the connection.
    const card = panel.getByRole("button", { name: "#7 Fix the lift doors" });
    await expect(card).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByRole("region", { name: "Open" })).toContainText("#7");
    await card.click();
    await expect(panel.getByRole("region", { name: "Description" })).toContainText(
      "The doors stick.",
    );
    // Raw HTML in the body is text, not markup.
    await expect(panel.getByRole("region", { name: "Description" })).toContainText(
      "<script>alert(1)</script>",
    );
    await expect(panel.locator("script")).toHaveCount(0);
    await panel.getByRole("button", { name: "Carry to a desk" }).click();
    await expect(panel).toHaveCount(0);
    const chip = ownerPage.getByRole("status", { name: "Carried card" });
    await expect(chip).toContainText("#7");
    await expect.poll(() => carriedCardsInScene(ownerPage)).toHaveLength(1);

    const desk = await freeDeskPoint(ownerPage, [spawnSeat]);
    if (!desk) throw new Error("no free desk in the scene");
    await ownerPage.mouse.click(desk.x, desk.y);
    const dialog = ownerPage.getByRole("dialog", { name: "Spawn a robot" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(desk.seatId)).toBeVisible();
    await expect(dialog.getByLabel("Task title")).toHaveValue("#7 Fix the lift doors");
    await expect(dialog.getByLabel("Issue", { exact: true })).toHaveValue("7");
    await expect(dialog.getByLabel(/Prompt/)).toHaveValue(
      /^Work on issue #7 in octo\/hello: Fix the lift doors/,
    );
    // The card went down on the desk.
    await expect(chip).toHaveCount(0);
    await expect.poll(() => carriedCardsInScene(ownerPage)).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await ownerPage.request
      .delete("/api/github/connection", { headers: { origin: new URL(ownerPage.url()).origin } })
      .catch(() => undefined);
    await gh?.close();
  }
});
