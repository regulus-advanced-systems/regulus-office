/**
 * The break-room coffee machine in the office e2e (#63): the owner walks up to the machine and
 * presses `E`; their HUD shows the buzz meter and their speed factor goes up, and the member's
 * browser shows the cup over the owner's head (shared presence). `E` typed into the chat takes
 * no cup. The third cup is the jitters: the owner's drawn body shakes in both browsers while
 * the pose the camera follows stays put, and a browser that asks for reduced motion draws it
 * standing still under a "Jitters" badge. The meter counts down to the end the server
 * published; the step does not wait for it (the server's own tests end a buzz, with injected
 * clocks), so the owner leaves this step buzzed for up to a minute.
 *
 * Reads the buzz through `window.__regulusCoffee` (apps/web/src/scene/coffee/probe.ts) and the
 * scene through `window.__regulusR3F`, both published with `?stats`. With `E2E_SHOTS_DIR` set it
 * also saves the screenshots for the PR and logs the measured walking speeds.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  cameraState,
  goToLobbyLevel,
  navPose,
  waitStill,
  walkTo,
  walkToLobby,
  wheelZoomTo,
} from "./compoundProbes.ts";
import { humans } from "./probes.ts";

type Point = { x: number; z: number };

interface CoffeeView {
  stand(): Point | null;
  self(): { cups: number; buzzUntil: number; boost: number };
  seen(): Record<string, { cups: number; shaking: boolean }>;
}

function coffee(): CoffeeView {
  const c = (window as unknown as { __regulusCoffee?: CoffeeView }).__regulusCoffee;
  if (!c) throw new Error("no __regulusCoffee (open the page with ?stats)");
  return c;
}

const self = (page: Page) =>
  page.evaluate(`(${coffee.toString()})().self()`) as Promise<ReturnType<CoffeeView["self"]>>;
const seen = (page: Page) =>
  page.evaluate(`(${coffee.toString()})().seen()`) as Promise<ReturnType<CoffeeView["seen"]>>;
const stand = async (page: Page): Promise<Point> => {
  const p = (await page.evaluate(`(${coffee.toString()})().stand()`)) as Point | null;
  if (!p) throw new Error("no coffee machine on this level");
  return p;
};

/** What the scene draws of the buzz: every cup badge, and every body that is shaking now. */
function drawn(
  page: Page,
): Promise<{ badges: { cups: number; jitters: boolean }[]; shaking: number }> {
  return page.evaluate(() => {
    type Obj = {
      name: string;
      userData: Record<string, unknown>;
      position: { x: number; z: number };
    };
    const r3f = (
      window as unknown as { __regulusR3F?: { scene: { traverse(f: (o: Obj) => void): void } } }
    ).__regulusR3F;
    const badges: { cups: number; jitters: boolean }[] = [];
    let shaking = 0;
    r3f?.scene.traverse((o) => {
      if (o.name === "buzz-badge")
        badges.push({ cups: Number(o.userData.cups), jitters: Boolean(o.userData.jitters) });
      // A shaking body is off its spot inside the human's own group.
      if (o.name === "jitters" && (o.position.x !== 0 || o.position.z !== 0)) shaking += 1;
    });
    return { badges, shaking };
  });
}

async function walkUpTo(page: Page, at: Point, near = 0.6): Promise<void> {
  await expect(async () => {
    const pose = await navPose(page);
    if (!pose.walking && Math.hypot(pose.x - at.x, pose.z - at.z) <= near) return;
    if (!pose.walking) expect(await walkTo(page, at.x, at.z)).toBe(true);
    throw new Error(`walking to ${at.x.toFixed(1)}, ${at.z.toFixed(1)}`);
  }).toPass({ timeout: 90_000, intervals: [200] });
  await waitStill(page);
}

async function pressE(page: Page): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("e");
}

/** When the last cup was granted (this process's clock), to keep to the machine's cooldown. */
let lastCupAt = 0;
/** COFFEE_COOLDOWN_MS (packages/protocol/src/coffee.ts) plus a margin. */
const BETWEEN_CUPS_MS = 2_800;

/**
 * One more cup for the page's player, who stands at the machine. The step waits out the
 * machine's cooldown first, so no cup is refused: a refusal is a toast, and a toast left
 * behind would lie over the next step's buttons. If one is refused all the same, `E` again.
 */
async function cup(page: Page, cups: number): Promise<void> {
  await expect(async () => {
    if ((await self(page)).cups >= cups) return;
    const wait = lastCupAt + BETWEEN_CUPS_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await pressE(page);
    await expect.poll(async () => (await self(page)).cups, { timeout: 2_000 }).toBe(cups);
  }).toPass({ timeout: 30_000, intervals: [BETWEEN_CUPS_MS] });
  lastCupAt = Date.now();
}

/**
 * Metres per second while walking from `from` to `to`: the median over the walk's frames of
 * the distance the player moved in the frame over the frame's length, by the page's own clock.
 */
async function walkingSpeed(page: Page, from: Point, to: Point): Promise<number> {
  await walkUpTo(page, from, 0.3);
  return page.evaluate(
    ({ to }) =>
      new Promise<number>((resolve, reject) => {
        type Pose = { x: number; z: number; walking: boolean };
        const nav = (
          window as unknown as {
            __regulusNav?: { pose(): Pose; walkTo(x: number, z: number): boolean };
          }
        ).__regulusNav;
        if (!nav?.walkTo(to.x, to.z)) {
          reject(new Error("no path"));
          return;
        }
        const speeds: number[] = [];
        let last = nav.pose();
        let lastT = performance.now();
        let idle = 0;
        const frame = (t: number) => {
          const now = nav.pose();
          const moved = Math.hypot(now.x - last.x, now.z - last.z);
          if (moved > 0 && t > lastT) speeds.push(moved / ((t - lastT) / 1000));
          idle = moved > 0 ? 0 : idle + 1;
          last = now;
          lastT = t;
          if (speeds.length > 10 && idle > 10) {
            speeds.sort((a, b) => a - b);
            resolve(speeds[Math.floor(speeds.length / 2)] ?? 0);
          } else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { to },
  );
}

export async function checkCoffee(owner: Page, member: Page, ownerName: string): Promise<void> {
  const shots = process.env.E2E_SHOTS_DIR;
  if (shots) mkdirSync(shots, { recursive: true });
  const shot = async (page: Page, name: string) => {
    if (shots) await page.screenshot({ path: join(shots, name) });
  };

  await goToLobbyLevel(owner);
  await goToLobbyLevel(member);
  const at = await stand(owner);
  // The member watches from the lobby: people on a level are drawn wherever they stand.
  // (For the PR's screenshots the member walks over, a few steps from the machine.)
  const watch = { x: at.x - 3, z: at.z };
  const lane = [
    { x: at.x - 9, z: at.z + 4.5 },
    { x: at.x - 1, z: at.z + 4.5 },
  ] as const;
  const sober = shots ? await walkingSpeed(owner, lane[0], lane[1]) : 0;
  if (shots) await walkUpTo(member, watch, 1.5);
  await walkUpTo(owner, at);

  // For the PR's screenshots only: both cameras close in on the machine.
  const zooms: [Page, number][] = [];
  if (shots)
    for (const page of [owner, member]) {
      await page.mouse.move(640, 330);
      zooms.push([page, (await cameraState(page)).wantZoom]);
      await wheelZoomTo(page, 0.12);
    }

  // Nobody is buzzed: no meter, no badge, normal speed.
  expect(await self(owner)).toMatchObject({ cups: 0, boost: 1 });
  await expect(owner.locator(".rg-buzz")).toHaveCount(0);
  expect((await drawn(member)).badges).toEqual([]);

  // `E` typed into the chat is a letter, not a cup. `T` opens the chat if an earlier step
  // folded it away, and puts the caret in it.
  const showChat = owner.getByRole("button", { name: "Show chat" });
  const folded = (await showChat.count()) > 0;
  await owner.bringToFront();
  await owner.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await owner.keyboard.press("t");
  const chat = owner.getByPlaceholder("Press T to chat");
  await expect(chat).toBeFocused();
  await owner.keyboard.type("e");
  await expect(chat).toHaveValue("e");
  await owner.waitForTimeout(300);
  expect((await self(owner)).cups).toBe(0);
  await chat.fill("");
  if (folded) await owner.getByRole("button", { name: "Hide chat" }).click();

  // The first cup: the owner's meter and speed, and the cup over their head for the member.
  await cup(owner, 1);
  expect((await self(owner)).boost).toBe(1.25);
  const meter = owner.locator(".rg-buzz");
  await expect(meter).toBeVisible();
  await expect(meter.locator(".rg-buzz__text")).toHaveText("+25% speed");
  await expect(meter.locator(".rg-buzz__cup--full")).toHaveCount(1);
  await expect.poll(async () => (await seen(member))[ownerName]?.cups).toBe(1);
  await expect
    .poll(async () => (await drawn(member)).badges)
    .toEqual([{ cups: 1, jitters: false }]);
  // The buzz is the owner's alone.
  expect(await self(member)).toMatchObject({ cups: 0, boost: 1 });
  await expect(member.locator(".rg-buzz")).toHaveCount(0);
  await shot(owner, "buzz-meter-first-cup.png");
  await shot(member, "member-sees-the-cup.png");

  // The third cup is the jitters: the body shakes in both browsers, the pose does not.
  await cup(owner, 2);
  await cup(owner, 3);
  await expect(meter.locator(".rg-buzz__jitters")).toBeVisible();
  await expect
    .poll(async () => (await seen(member))[ownerName])
    .toEqual({ cups: 3, shaking: true });
  await expect.poll(async () => (await drawn(member)).shaking).toBe(1);
  await expect.poll(async () => (await drawn(owner)).shaking).toBe(1);
  const still = await navPose(owner);
  for (let i = 0; i < 8; i++) {
    await owner.waitForTimeout(60);
    const now = await navPose(owner);
    expect([now.x, now.z, now.walking]).toEqual([still.x, still.z, false]);
  }
  expect((await self(owner)).boost).toBe(1.25);
  await shot(owner, "jitters-owner.png");
  await shot(member, "jitters-seen-by-member.png");

  // A viewer who asked for less motion: the body stands still, the badge says it.
  await member.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await seen(member))[ownerName]?.shaking).toBe(false);
  await expect.poll(async () => (await drawn(member)).shaking).toBe(0);
  expect((await drawn(member)).badges).toEqual([{ cups: 3, jitters: true }]);
  await shot(member, "jitters-reduced-motion.png");
  await member.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => (await drawn(member)).shaking).toBe(1);

  if (shots) {
    // Measured, on a machine that draws fast enough (frames under 0.1 s): a quarter faster.
    const buzzed = await walkingSpeed(owner, lane[0], lane[1]);
    console.log(
      `coffee: walk ${sober.toFixed(2)} m/s sober, ${buzzed.toFixed(2)} m/s buzzed (x${(buzzed / sober).toFixed(2)})`,
    );
    expect(buzzed / sober).toBeGreaterThan(1.15);
    expect(buzzed / sober).toBeLessThan(1.35);
    // The member sees the buzzed owner arrive where the owner is: no rubber band, no jump back.
    await waitStill(owner);
    const end = await navPose(owner);
    await expect
      .poll(async () => {
        const all = await humans(member);
        const others = Object.entries(all).filter(([name]) => name.startsWith("human-"));
        return Math.min(...others.map(([, p]) => Math.hypot(p.x - end.x, p.z - end.z)));
      })
      .toBeLessThan(0.05);
  }

  // The buzz ends when the server says (its tests cover that, with their own clocks): the step
  // does not wait the minute out. Here: the end the server published is a minute after the
  // last cup, and the meter counts down towards it.
  const left = (await self(owner)).buzzUntil - Date.now();
  expect(left).toBeGreaterThan(30_000);
  expect(left).toBeLessThanOrEqual(61_000);
  const seconds = async () =>
    Number.parseInt((await meter.locator(".rg-buzz__time").innerText()) || "", 10);
  const first = await seconds();
  expect(first).toBeGreaterThan(30);
  expect(first).toBeLessThanOrEqual(60);
  await expect.poll(seconds, { timeout: 5_000 }).toBeLessThan(first);
  const fill = Number((await meter.getByRole("progressbar").getAttribute("aria-valuenow")) ?? -1);
  expect(Math.abs(fill - ((await seconds()) / 60) * 100)).toBeLessThan(5);

  // Nothing of this step is left over the HUD: the cup notices go by themselves.
  const notices = owner.locator(".rg-toast").filter({ hasText: /coffee|cup/i });
  await expect(notices).toHaveCount(0, { timeout: 10_000 });

  for (const [page, zoom] of zooms) {
    await page.mouse.move(640, 330);
    await wheelZoomTo(page, zoom);
  }
  await walkToLobby(owner);
  if (shots) await walkToLobby(member);
}
