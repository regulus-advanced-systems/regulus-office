/**
 * Manual check of voice and the lounge TV (#48) against a real LiveKit, with two
 * headless Chromiums using fake media devices. Not part of `bun run e2e` (that office
 * runs without LiveKit); run by hand, see docs/deploy/media.md "Verify":
 *
 *   MEDIA_BASE_URL=http://127.0.0.1:4620 bunx playwright test -c tests/e2e/media/playwright.media.ts
 *
 * against a fresh office started with LIVEKIT_API_KEY/SECRET/URL pointing at a running
 * livekit-server. Screenshots go to docs/screenshots/48 when MEDIA_SHOTS=1.
 */
import { mkdirSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { navPose, waitStill, walkTo, wheelZoomTo } from "../compoundProbes.ts";
import { pickGenius } from "../geniusChecks.ts";
import { distance, OFFICE_PROBE_PATH, remoteHumans, waitForScene } from "../probes.ts";

const SHOTS = process.env.MEDIA_SHOTS === "1" ? "docs/screenshots/48" : null;
const stamp = Date.now();
const owner = {
  name: "Olga",
  email: `olga${stamp}@example.com`,
  password: "correct horse battery staple",
};
const member = {
  name: "Milo",
  email: `milo${stamp}@example.com`,
  password: "correct horse battery staple",
};

let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let ownerPage: Page;
let memberPage: Page;
let ownerSession = "";
let memberSession = "";

type MediaState = {
  connection: string;
  voices: Record<string, { mic: string; speaking: boolean; level: number }>;
  screen: string | null;
  sharing: string;
  tvOpen: boolean;
};
const media = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __regulusMedia?: { state(): unknown } }).__regulusMedia?.state(),
  ) as Promise<MediaState | undefined>;
const gains = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __regulusMedia?: { gains(): Record<string, number> } }
      ).__regulusMedia?.gains() ?? {},
  );

/** Scene facts about a human group: mouth visibility and the voice badge. */
function headOf(page: Page, group: string) {
  return page.evaluate((name) => {
    type Obj = {
      name: string;
      visible: boolean;
      userData: Record<string, unknown>;
      traverse(f: (o: Obj) => void): void;
    };
    const r3f = (window as unknown as { __regulusR3F?: { scene: Obj } }).__regulusR3F;
    let g: Obj | null = null;
    r3f?.scene.traverse((o) => {
      if (!g && o.name === name) g = o;
    });
    if (!g) return null;
    let mouth = false;
    let badge: string | null = null;
    (g as Obj).traverse((o) => {
      if (o.name === "genius-mouth" && o.visible) mouth = true;
      if (o.name === "voice-badge") badge = String(o.userData.kind);
    });
    return { mouth, badge };
  }, group);
}

function tvLive(page: Page) {
  return page.evaluate(() => {
    type Obj = {
      name: string;
      userData: Record<string, unknown>;
      traverse(f: (o: Obj) => void): void;
    };
    const r3f = (window as unknown as { __regulusR3F?: { scene: Obj } }).__regulusR3F;
    let live: boolean | null = null;
    r3f?.scene.traverse((o) => {
      if (o.name === "lounge-tv-screen") live = Boolean(o.userData.live);
    });
    return live;
  });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ["day", "night"] as const) {
    await page.emulateMedia({ colorScheme: scheme === "day" ? "light" : "dark" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: "dark" });
}

async function register(page: Page, who: typeof owner, submit: string) {
  await page.getByLabel("Display name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByLabel("Confirm password").fill(who.password);
  await page.getByRole("button", { name: submit }).click();
  await expect(page).toHaveURL(/\/office/);
}

async function focusScene(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator("canvas").first().hover();
}

const sessionOf = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __regulusMedia?: unknown }).__regulusMedia !== undefined,
  );

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  ownerCtx = await browser.newContext({ permissions: ["microphone"] });
  memberCtx = await browser.newContext({ permissions: ["microphone"] });
  ownerPage = await ownerCtx.newPage();
  memberPage = await memberCtx.newPage();
});

test.afterAll(async () => {
  await ownerCtx?.close();
  await memberCtx?.close();
});

test("owner and member sign in; both connect to LiveKit", async () => {
  await ownerPage.goto("/login");
  await register(ownerPage, owner, "Create the owner account");
  await ownerPage.bringToFront();
  await pickGenius(ownerPage, "Mastermind");
  await ownerPage.getByRole("button", { name: "Settings" }).click();
  await ownerPage.getByRole("tab", { name: "You" }).click();
  await ownerPage.getByRole("button", { name: "Invite someone…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByRole("button", { name: "Create invite link" }).click();
  const link = dialog.getByLabel(/Invite link for member/);
  await expect(link).toHaveValue(/\/join\/[\w-]+$/);
  const invite = await link.inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  await memberPage.bringToFront();
  await memberPage.goto(invite);
  await register(memberPage, member, "Create account and join");
  await pickGenius(memberPage, "Diva");

  await ownerPage.goto(OFFICE_PROBE_PATH);
  await memberPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(ownerPage);
  await waitForScene(memberPage);
  await expect.poll(() => sessionOf(ownerPage)).toBe(true);
  for (const page of [ownerPage, memberPage])
    await expect
      .poll(async () => (await media(page))?.connection, { timeout: 30_000 })
      .toBe("connected");
  await expect.poll(() => remoteHumans(memberPage)).toHaveLength(1);
  ownerSession = ((await remoteHumans(memberPage))[0] ?? "").replace(/^human-/, "");
  memberSession = ((await remoteHumans(ownerPage))[0] ?? "").replace(/^human-/, "");
  expect(ownerSession && memberSession).toBeTruthy();
  await expect(ownerPage.getByTestId("media-strip")).toBeVisible();
});

test("the owner talks: the member hears them at their spatial level, the mouth moves", async () => {
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Mic on" }).click();
  await expect
    .poll(async () => (await media(memberPage))?.voices[ownerSession]?.mic, { timeout: 20_000 })
    .toBe("on");
  await expect
    .poll(async () => (await gains(memberPage))[ownerSession] ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0);
  // The fake microphone talks (MEDIA_FAKE_AUDIO): LiveKit reports the owner speaking...
  await expect
    .poll(async () => (await media(memberPage))?.voices[ownerSession]?.speaking, {
      timeout: 30_000,
      intervals: [50],
    })
    .toBe(true);
  // ...and the mouth opens (drawn in the frame loop, which only runs in the page in front).
  await memberPage.bringToFront();
  await expect
    .poll(async () => (await headOf(memberPage, `human-${ownerSession}`))?.mouth, {
      timeout: 30_000,
      intervals: [30],
    })
    .toBe(true);
  console.log("member hears owner at gain", (await gains(memberPage))[ownerSession]);
});

test("walking away fades the voice to nothing; coming back brings it back", async () => {
  const gain = async () => (await gains(memberPage))[ownerSession] ?? 0;
  await ownerPage.bringToFront();
  const start = await navPose(ownerPage);
  const listener = await navPose(memberPage);
  const samples: string[] = [];
  const sample = async () => {
    const g = await gain();
    const at = await navPose(ownerPage);
    samples.push(
      `${distance(at, listener).toFixed(1)} m (${at.room ?? "corridor"}): ${g.toFixed(3)}`,
    );
    return g;
  };
  // Out of the lobby door and along the corridor: well past the 18 m reach.
  expect(await walkTo(ownerPage, start.x - 26, start.z - 10)).toBe(true);
  await expect.poll(sample, { timeout: 240_000, intervals: [1_000] }).toBe(0);
  await waitStill(ownerPage, 240_000);
  expect(await walkTo(ownerPage, start.x, start.z)).toBe(true);
  await expect.poll(sample, { timeout: 240_000, intervals: [1_000] }).toBeGreaterThan(0.5);
  console.log(`owner's voice at the member, by distance:\n  ${samples.join("\n  ")}`);
  await waitStill(ownerPage, 240_000);
});

test("muting shows the badge over the owner's head", async () => {
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Mute mic" }).click();
  await expect.poll(async () => (await media(memberPage))?.voices[ownerSession]?.mic).toBe("muted");
  await expect
    .poll(async () => (await headOf(memberPage, `human-${ownerSession}`))?.badge)
    .toBe("muted");
  await ownerPage.getByRole("button", { name: "Unmute mic" }).click();
  await expect
    .poll(async () => (await headOf(memberPage, `human-${ownerSession}`))?.badge)
    .toBeNull();
});

test("the owner shares the screen: it plays on the lounge TV for the member", async () => {
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Share screen" }).click();
  await expect
    .poll(async () => (await media(ownerPage))?.sharing, { timeout: 20_000 })
    .toBe("live");
  await expect
    .poll(async () => (await media(memberPage))?.screen, { timeout: 20_000 })
    .toBe(ownerSession);
  await expect.poll(() => tvLive(memberPage), { timeout: 20_000 }).toBe(true);
  await expect
    .poll(async () => (await headOf(memberPage, `human-${ownerSession}`))?.badge)
    .toBe("sharing");
  // A second sharer is refused while the TV is taken.
  await expect(memberPage.getByRole("button", { name: "Share screen" })).toHaveCount(0);
  await expect(memberPage.getByRole("button", { name: /^Watch Olga/ })).toBeVisible();
});

test("the member sits on the sofa: the TV opens full screen, the picture plays", async () => {
  await memberPage.bringToFront();
  const seat = (await memberPage.evaluate(`window.__regulusNav.humanSeat("lobby/sofa-2")`)) as {
    x: number;
    z: number;
  };
  await expect(async () => {
    const pose = await navPose(memberPage);
    if (distance(pose, seat) < 1.6 && !pose.walking) return;
    if (!pose.walking) expect(await walkTo(memberPage, seat.x, seat.z - 1)).toBe(true);
    throw new Error("walking to the sofa");
  }).toPass({ timeout: 240_000, intervals: [500, 1_000] });
  await waitStill(memberPage);
  await focusScene(memberPage);
  await memberPage.keyboard.press("e");
  await expect.poll(async () => (await media(memberPage))?.tvOpen).toBe(true);
  const video = memberPage.getByTestId("tv-video");
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await shot(memberPage, "tv-fullscreen");
  await memberPage.keyboard.press("Escape");
  await expect.poll(async () => (await media(memberPage))?.tvOpen).toBe(false);
  await focusScene(memberPage);
  await wheelZoomTo(memberPage, 0.15);
  await shot(memberPage, "lounge-tv-share");
});

test("speaking indicator: the owner's mouth seen up close", async () => {
  const seat = (await memberPage.evaluate(`window.__regulusNav.humanSeat("lobby/sofa-2")`)) as {
    x: number;
    z: number;
  };
  // The owner walks round to stand between the TV and the coffee table, then steps
  // towards the sofa so they face the seated member (and the camera behind them).
  await ownerPage.bringToFront();
  for (const [x, z] of [
    [seat.x + 2.2, seat.z - 4.35],
    [seat.x, seat.z - 4.35],
    [seat.x, seat.z - 4.0],
  ] as const) {
    expect(await walkTo(ownerPage, x, z)).toBe(true);
    await waitStill(ownerPage, 240_000);
  }
  await focusScene(memberPage);
  await wheelZoomTo(memberPage, 0.05);
  const mouthOpen = () => headOf(memberPage, `human-${ownerSession}`).then((h) => h?.mouth);
  await expect.poll(mouthOpen, { timeout: 20_000, intervals: [30] }).toBe(true);
  if (SHOTS)
    for (const scheme of ["day", "night"] as const) {
      await memberPage.emulateMedia({ colorScheme: scheme === "day" ? "light" : "dark" });
      await expect.poll(mouthOpen, { timeout: 20_000, intervals: [20] }).toBe(true);
      await memberPage.screenshot({ path: `${SHOTS}/speaking-${scheme}.png` });
    }
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Mute mic" }).click();
  await expect
    .poll(async () => (await headOf(memberPage, `human-${ownerSession}`))?.badge)
    .toBe("sharing");
});

test("the sharer stops; the TV goes back to the test card", async () => {
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Stop sharing" }).first().click();
  await expect.poll(async () => (await media(memberPage))?.screen, { timeout: 20_000 }).toBeNull();
  await expect.poll(() => tvLive(memberPage)).toBe(false);
  // Still muted: the badge over the owner's head says so.
  await expect
    .poll(async () => (await headOf(memberPage, `human-${ownerSession}`))?.badge)
    .toBe("muted");
  await memberPage.bringToFront();
  await shot(memberPage, "muted-badge");
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Unmute mic" }).click();
  await expect
    .poll(async () => (await headOf(memberPage, `human-${ownerSession}`))?.badge)
    .toBeNull();
});

test("settings: microphone, push-to-talk and voice volume", async () => {
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Settings" }).click();
  const settings = ownerPage.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: "Display and sound" }).click();
  await expect(settings.getByLabel("Microphone")).toBeVisible();
  await expect(settings.getByText("Push to talk")).toBeVisible();
  await shot(ownerPage, "settings-voice");
  await settings.getByRole("button", { name: "Done" }).click();
});
