/**
 * The lobby whiteboard in the office e2e (#45): both browsers click the board on the lobby
 * wall, the full-screen Excalidraw opens (loaded lazily) and goes live over Yjs; each draws a
 * rectangle and sees the other's; closing it uploads the wall snapshot, and the other browser's
 * wall shows it (the snapshot version arrives through the BuildingRoom state).
 *
 * Reads the open board through `window.__regulusWhiteboard` and the wall texture through the
 * R3F scene (both published with `?stats`). With `E2E_SHOTS_DIR` set it also saves the
 * screenshots for the PR (editor and wall, night and day shift).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  cameraState,
  clickInScene,
  navPose,
  waitStill,
  walkTo,
  wheelZoomTo,
} from "./compoundProbes.ts";

const HOTSPOT = "lobby-whiteboard-hotspot";

const board = (page: Page) => page.getByRole("dialog", { name: "Whiteboard: Lobby" });

/** Element ids on the open board. */
export const boardIds = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      (
        window as unknown as { __regulusWhiteboard?: { ids(): string[] } }
      ).__regulusWhiteboard?.ids() ?? [],
  );

/** The snapshot version painted on the lobby wall (0: blank, -1: no board in the scene). */
export const wallVersion = (page: Page): Promise<number> =>
  page.evaluate(() => {
    type Obj = {
      name: string;
      material?: { map?: { userData: { version?: number } } | null };
      traverse(fn: (o: Obj) => void): void;
    };
    const r3f = (
      window as unknown as {
        __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
      }
    ).__regulusR3F;
    const group = r3f?.scene.getObjectByName("lobby-whiteboard");
    if (!group) return -1;
    let version = 0;
    group.traverse((o) => {
      if (o.name === "whiteboard-face") version = o.material?.map?.userData.version ?? 0;
    });
    return version;
  });

/** Open the lobby board from the 3D wall and wait until it is live. */
export async function openLobbyBoard(page: Page): Promise<void> {
  await page.bringToFront();
  await clickInScene(page, HOTSPOT, board(page));
  await expect(board(page).getByRole("status")).toHaveText("Live", { timeout: 30_000 });
  await expect(board(page).locator(".excalidraw canvas").first()).toBeVisible();
}

/** Draw a rectangle with the toolbar tool, at fractions of the board's area. */
export async function drawRectangle(page: Page, fx: number, fy: number): Promise<void> {
  await page.bringToFront();
  const dialog = board(page);
  // Excalidraw's tool buttons are labels around a visually hidden radio.
  await dialog
    .locator("label", { has: page.getByTestId("toolbar-rectangle") })
    .click({ timeout: 15_000 });
  const area = await dialog.locator(".rg-whiteboard__body").boundingBox();
  if (!area) throw new Error("no board area");
  const x = area.x + area.width * fx;
  const y = area.y + area.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 70, { steps: 8 });
  await page.mouse.up();
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(600);
    const shift = scheme === "dark" ? "night" : "day";
    await page.screenshot({ path: join(dir, `${name}-${shift}.jpg`), quality: 82, type: "jpeg" });
  }
  await page.emulateMedia({ colorScheme: null });
}

export async function checkWhiteboard(owner: Page, member: Page): Promise<void> {
  // Where both stood and how the owner's camera was: the later steps expect them back.
  const homes = [await navPose(owner), await navPose(member)];
  const zoom = (await cameraState(owner)).wantZoom;
  await openLobbyBoard(owner);
  await openLobbyBoard(member);

  // Each draws; each sees the other's stroke (Yjs through /ws/wb/lobby).
  await drawRectangle(owner, 0.3, 0.35);
  await expect.poll(() => boardIds(owner)).toHaveLength(1);
  await expect.poll(() => boardIds(member), { timeout: 20_000 }).toHaveLength(1);
  await drawRectangle(member, 0.55, 0.55);
  await expect.poll(() => boardIds(member)).toHaveLength(2);
  await expect.poll(() => boardIds(owner), { timeout: 20_000 }).toHaveLength(2);
  expect((await boardIds(owner)).sort()).toEqual((await boardIds(member)).sort());
  await shot(owner, "01-editor");

  // Closing uploads the last snapshot; the other browser's wall picks up the new version.
  await member.getByRole("button", { name: "Close whiteboard" }).click();
  await expect(board(member)).toBeHidden();
  await owner.getByRole("button", { name: "Close whiteboard" }).click();
  await expect(board(owner)).toBeHidden();
  await expect.poll(() => wallVersion(member), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => wallVersion(owner), { timeout: 30_000 }).toBeGreaterThan(0);
  if (process.env.E2E_SHOTS_DIR) {
    // Step back from the wall and zoom in, so the picture shows the board, not the player.
    const at = await owner.evaluate(() => {
      type V = { x: number; z: number; clone(): V };
      type Obj = { position: V; getWorldPosition(v: V): V };
      const r3f = (
        window as unknown as {
          __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
        }
      ).__regulusR3F;
      const o = r3f?.scene.getObjectByName("lobby-whiteboard");
      const w = o?.getWorldPosition(o.position.clone());
      return w ? { x: w.x, z: w.z } : null;
    });
    if (at) await walkTo(member, at.x + 4, at.z + 5);
    if (at) await walkTo(owner, at.x, at.z + 3.2);
    await waitStill(owner);
    await owner.mouse.move(640, 420);
    await wheelZoomTo(owner, 0.15);
    await shot(owner, "02-wall");
  }
  // Back where they were, out of the board's reach (`E` must not open it in later steps).
  for (const [i, page] of [owner, member].entries()) {
    const home = homes[i];
    if (home) await walkTo(page, home.x, home.z);
  }
  await waitStill(owner);
  await waitStill(member);
  await owner.mouse.move(640, 420);
  await wheelZoomTo(owner, zoom);
}
