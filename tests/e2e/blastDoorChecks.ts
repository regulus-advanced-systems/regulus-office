/**
 * The lobby's blast door in the office e2e (#188): the doorway is shut and the beach out of
 * reach; the owner walks up to the lobby button and presses `E`; the door opens for the second
 * browser too (shared state, its leaves slide in that page as well); the owner walks out onto
 * the dock; the door shuts by itself after the office's (shortened) open time and the nav grid
 * is blocked again; then the keypad outside lets the owner back in.
 *
 * Reads the outside through `window.__regulusOutside` (apps/web/src/scene/compound/outside/
 * probe.ts, published with `?stats`) and walks by nav state (compoundProbes.ts).
 */
import { expect, type Page } from "@playwright/test";
import { goToLobbyLevel, navPose, waitStill, walkTo, walkToLobby } from "./compoundProbes.ts";

type Point = { x: number; z: number };

interface DoorView {
  phase: string;
  presses: number;
  openedBy: string;
  travel: number;
  alarm: boolean;
  moving: boolean;
}

interface OutsidePoints {
  insideButton: Point;
  outsideButton: Point;
  doorway: Point;
  lobby: Point;
  beach: Point;
  dock: Point;
  dockEnd: Point;
}

function outside(): {
  door(): DoorView;
  points(): OutsidePoints | null;
  walkable(x: number, z: number): boolean;
} {
  const o = (window as unknown as { __regulusOutside?: ReturnType<typeof outside> })
    .__regulusOutside;
  if (!o) throw new Error("no __regulusOutside (open the page with ?stats)");
  return o;
}

const door = (page: Page): Promise<DoorView> =>
  page.evaluate(`(${outside.toString()})().door()`) as Promise<DoorView>;
const points = async (page: Page): Promise<OutsidePoints> => {
  const p = (await page.evaluate(`(${outside.toString()})().points()`)) as OutsidePoints | null;
  if (!p) throw new Error("no outside in this compound");
  return p;
};
const walkable = (page: Page, at: Point): Promise<boolean> =>
  page.evaluate(`(${outside.toString()})().walkable(${at.x}, ${at.z})`) as Promise<boolean>;

/** Walk to a point and wait until the player stands there (within `near` metres). */
async function walkUpTo(page: Page, at: Point, near = 0.6): Promise<void> {
  await expect(async () => {
    const pose = await navPose(page);
    if (!pose.walking && Math.hypot(pose.x - at.x, pose.z - at.z) <= near) return;
    if (!pose.walking) expect(await walkTo(page, at.x, at.z)).toBe(true);
    throw new Error(`walking to ${at.x.toFixed(1)}, ${at.z.toFixed(1)}`);
  }).toPass({ timeout: 90_000, intervals: [500, 1_000] });
}

/** Press `E` in the page, as the player standing at the button would. */
async function pressE(page: Page): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("e");
}

export async function checkBlastDoor(owner: Page, member: Page, ownerName: string): Promise<void> {
  // Both on the lobby level (#268): people see each other only on the same level.
  await goToLobbyLevel(owner);
  await goToLobbyLevel(member);
  await walkToLobby(owner);
  const at = await points(owner);
  await expect.poll(async () => (await door(member)).phase).toBe("closed");
  const before = await door(member);

  // Shut: the doorway is solid and the beach cannot be reached.
  expect(await walkable(owner, at.doorway)).toBe(false);
  expect(await walkTo(owner, at.beach.x, at.beach.z)).toBe(false);

  // The owner walks up to the lobby button and presses E.
  await walkUpTo(owner, at.insideButton);
  await waitStill(owner);
  await pressE(owner);

  // Shared: the member's page sees it open, who opened it, and its leaves sliding open.
  await expect.poll(async () => (await door(member)).phase).toBe("open");
  const opened = await door(member);
  expect(opened.presses).toBe(before.presses + 1);
  expect(opened.openedBy).toBe(ownerName);
  await expect.poll(async () => (await door(member)).travel, { timeout: 30_000 }).toBe(1);
  expect((await door(member)).alarm).toBe(true);

  // Open: the owner walks out through the doorway, over the sand and onto the dock.
  await expect.poll(() => walkable(owner, at.doorway)).toBe(true);
  await walkUpTo(owner, at.dock, 1);
  const onDock = await navPose(owner);
  expect(onDock.z).toBeGreaterThan(at.doorway.z + 6);
  expect(onDock.room).toBeNull();

  // It shuts by itself after the (shortened) open time; the way back in is blocked again.
  await expect.poll(async () => (await door(owner)).phase, { timeout: 60_000 }).toBe("closed");
  await expect.poll(() => walkable(owner, at.doorway)).toBe(false);
  expect(await walkTo(owner, at.lobby.x, at.lobby.z)).toBe(false);
  await expect.poll(async () => (await door(member)).phase).toBe("closed");
  await expect.poll(async () => (await door(member)).travel, { timeout: 30_000 }).toBe(0);

  // The keypad outside opens it again, and the owner walks back into the lobby.
  await walkUpTo(owner, at.outsideButton);
  await waitStill(owner);
  await pressE(owner);
  await expect.poll(async () => (await door(owner)).phase).toBe("open");
  await expect.poll(() => walkable(owner, at.doorway)).toBe(true);
  await walkToLobby(owner);
}
