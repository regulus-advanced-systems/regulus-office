/**
 * First person and windows (#282, SPEC §9.2): opening a window in first
 * person frees the pointer and holds the view and the player still; closing
 * it (the X or Escape) is first person again, facing the same way.
 *
 * Starts and ends in third person with the issue board open, where the
 * board step that calls it carries on. The human stands at the board (the
 * click that opened it walked them there), so `E` opens it in first person.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { clickInScene, navPose, waitStill } from "./compoundProbes.ts";
import { cameraName } from "./probes.ts";

interface Facing {
  /** Camera quaternion and position. */
  q: number[];
  p: number[];
}

function facing(page: Page): Promise<Facing | null> {
  return page.evaluate(() => {
    type Cam = {
      quaternion: { x: number; y: number; z: number; w: number };
      position: { x: number; y: number; z: number };
    };
    const r3f = (window as unknown as { __regulusR3F?: { get(): { camera: Cam } } }).__regulusR3F;
    const c = r3f?.get().camera;
    return c
      ? {
          q: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w],
          p: [c.position.x, c.position.y, c.position.z],
        }
      : null;
  });
}

const pointerLocked = (page: Page) => page.evaluate(() => document.pointerLockElement !== null);

function expectSameFacing(now: Facing | null, before: Facing | null): void {
  if (!now || !before) throw new Error("no camera");
  for (let i = 0; i < 4; i++) expect(now.q[i]).toBeCloseTo(before.q[i] ?? 0, 6);
  for (let i = 0; i < 3; i++) expect(now.p[i]).toBeCloseTo(before.p[i] ?? 0, 4);
}

/** Mouse travel and a held W: what would turn and walk in first person. */
async function tryToLookAndWalk(page: Page): Promise<void> {
  await page.mouse.move(500, 300);
  await page.mouse.move(760, 420, { steps: 6 });
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
}

export async function checkFirstPersonWindow(
  page: Page,
  panel: Locator,
  card: Locator,
): Promise<void> {
  const toggle = page.getByRole("button", { name: /First person/ });
  const hint = page.locator(".rg-viewtoggle__hint");
  // At the board, the panel closed, in first person with the pointer locked.
  await waitStill(page);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("v");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => cameraName(page)).toBe("fpv-camera");
  await expect.poll(() => pointerLocked(page)).toBe(true);
  // Let the lock settle (the rig holds the view for a moment after it) before reading the view.
  await page.waitForTimeout(400);
  const before = await facing(page);
  const stood = await navPose(page);

  // A window opens: the cursor is free, the mouse and W no longer move anything.
  await page.keyboard.press("e");
  await expect(panel).toBeVisible();
  await expect.poll(() => pointerLocked(page)).toBe(false);
  await expect(hint).toContainText("paused while a window is open");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await tryToLookAndWalk(page);
  expectSameFacing(await facing(page), before);
  const during = await navPose(page);
  expect(during.x).toBeCloseTo(stood.x, 4);
  expect(during.z).toBeCloseTo(stood.z, 4);

  // The cursor works in it: open a card, go back.
  await card.click();
  await expect(panel.getByRole("region", { name: "Description" })).toBeVisible();
  await tryToLookAndWalk(page);
  expectSameFacing(await facing(page), before);

  // Closed with the X: still first person, facing the same way, the pointer taken back.
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await cameraName(page)).toBe("fpv-camera");
  expectSameFacing(await facing(page), before);
  await expect.poll(() => pointerLocked(page)).toBe(true);
  await expect(hint).not.toContainText("paused");

  // Closed with Escape: the window takes the key, first person stays.
  await page.keyboard.press("e");
  await expect(panel).toBeVisible();
  await expect.poll(() => pointerLocked(page)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await cameraName(page)).toBe("fpv-camera");
  expectSameFacing(await facing(page), before);

  // Back to third person, the board open again for the step that called.
  await page.keyboard.press("v");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => cameraName(page)).not.toBe("fpv-camera");
  await clickInScene(page, "board-hotspot-issue-board", panel);
  await expect(card).toBeVisible();
}
