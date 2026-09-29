/**
 * M0 smoke test (docs/SPEC.md §10 M0 exit criteria): the owner registers,
 * mints an invite in the UI, a second browser joins through the link, both
 * reach /office and see each other, one walks and the other sees it move,
 * chat crosses between them, the first-person view toggles on V and back,
 * the owner's robot turns to follow the mouse and walks face-first to a click,
 * the owner adds a floor bound to a (local) repo and rides to it, and
 * clicking a free desk there opens the spawn dialog, whose agent.spawn gets
 * an answer from the server (no agent CLI runs in e2e).
 *
 * Runs against office-server in production mode (see playwright.config.ts),
 * so room joins are authorised by the Better Auth session cookie only.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createRemoteRepo } from "./gitRemote.ts";
import {
  angleBetween,
  cameraType,
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

test("V toggles the first-person view and back", async () => {
  await ownerPage.bringToFront();
  const toggle = ownerPage.getByRole("button", { name: /First person/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await cameraType(ownerPage)).toBe("OrthographicCamera");

  await ownerPage.keyboard.press("v");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => cameraType(ownerPage)).toBe("PerspectiveCamera");

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
