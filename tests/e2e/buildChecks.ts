/**
 * Build mode in the e2e flows (#187): read the ghost through
 * `window.__regulusBuild` (published with `?stats`, apps/web/src/ui/build-mode),
 * aim it with the real mouse at a compound spot, and add a project room the
 * way an owner does: Add operation, Choose a spot…, then build on the map.
 */
import { expect, type Page } from "@playwright/test";
import { cameraSettled, navRooms } from "./compoundProbes.ts";
import { screenPointOf } from "./probes.ts";

export interface Placement {
  gridX: number;
  gridY: number;
  width: number;
  depth: number;
  doorSide: string;
}

export interface BuildProbe {
  active: boolean;
  kind: "create" | "move" | null;
  placement: Placement | null;
  pinned: boolean;
  server: { key: string; ok: boolean; reason?: string; conflicts: string[] } | null;
  watching: string | null;
}

export const buildProbe = (page: Page): Promise<BuildProbe> =>
  page.evaluate(() => {
    const b = (window as unknown as { __regulusBuild?: () => BuildProbe }).__regulusBuild;
    if (!b) throw new Error("no __regulusBuild (open the page with ?stats)");
    return b();
  });

const key = (p: Placement) => `${p.gridX},${p.gridY},${p.width}x${p.depth},${p.doorSide}`;

/** Wait for the server's answer about the ghost's current spot; true when it is clear. */
export async function settledVerdict(page: Page): Promise<BuildProbe> {
  let last: BuildProbe | null = null;
  await expect
    .poll(async () => {
      last = await buildProbe(page);
      return Boolean(last.placement && last.server && last.server.key === key(last.placement));
    })
    .toBe(true);
  if (!last) throw new Error("no build probe");
  return last;
}

/**
 * Move the mouse over the compound point (metres) so the ghost's middle lands there.
 * Build mode pulls the camera out to the overview; the aim waits until it has settled
 * (a moving camera would put the ghost elsewhere) and checks where the ghost went.
 */
export async function aimAt(page: Page, x: number, z: number): Promise<void> {
  await cameraSettled(page);
  await expect(async () => {
    const at = await screenPointOf(page, { x, z });
    if (!at) throw new Error("no camera");
    await page.mouse.move(at.x - 3, at.y - 3);
    await page.mouse.move(at.x, at.y, { steps: 3 });
    const p = (await buildProbe(page)).placement;
    if (!p) throw new Error("no ghost");
    const m = middleOf(p);
    // Within a tile (the ghost may be held at the compound's edge).
    expect(Math.abs(m.x - x)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.z - z)).toBeLessThanOrEqual(2);
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
}

/** Metres of a placement's middle (1 tile = 2 m). */
export const middleOf = (p: Placement) => ({
  x: (p.gridX + p.width / 2) * 2,
  z: (p.gridY + p.depth / 2) * 2,
});

/** Open Add operation, name the operation and its repo, and continue into build mode. */
export async function openBuildMode(page: Page, name: string, repo: string): Promise<BuildProbe> {
  const rooms = page.getByRole("navigation", { name: "Rooms" });
  await rooms.getByRole("button", { name: "New operation…" }).click();
  const dialog = page.getByRole("dialog", { name: "New operation" });
  await dialog.getByLabel("Operation name").fill(name);
  await dialog.getByLabel("Repo 1", { exact: true }).fill(repo);
  await dialog.getByRole("button", { name: "Choose a spot…" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: `Build ${name}` })).toBeVisible();
  return settledVerdict(page);
}

/**
 * Make sure the operation is on the compound, so a step that works in it does not depend on the
 * step that builds it in the UI (#248). Builds it where build mode offers, as an owner would.
 */
export async function ensureOperation(page: Page, name: string, repo: string): Promise<void> {
  await page.bringToFront();
  const room = async () => (await navRooms(page)).find((r) => r.name === name);
  if (!(await room())) {
    expect((await openBuildMode(page, name, repo)).server?.ok).toBe(true);
    await page.keyboard.press("Enter");
    const added = page.getByRole("dialog", { name: "Operation set up" });
    await expect(added.getByText("Ready on trunk")).toBeVisible();
    await added.getByRole("button", { name: "Done" }).click();
    await expect(added).toHaveCount(0);
  }
  await expect.poll(async () => (await room())?.buildState).toBe("ready");
}

/** A room's settings as the server has them (#182). */
export async function roomSettingsOf(
  page: Page,
  operationId: string,
): Promise<{ deskCount: number; decorStyle: string }> {
  const res = await page.request.get(
    `/api/operations/${encodeURIComponent(operationId)}/room-settings`,
  );
  expect(res.ok()).toBe(true);
  return (await res.json()) as { deskCount: number; decorStyle: string };
}

/**
 * In a room the page manages: Room settings, one more desk (D8 rooms start
 * with one), previewed live before Save, kept after it.
 */
export async function addDeskInRoomSettings(page: Page, operationId: string, name: string) {
  const desk = (seat: string) =>
    page.evaluate(
      (object) =>
        Boolean(
          (
            window as unknown as {
              __regulusR3F?: { scene: { getObjectByName(n: string): unknown } };
            }
          ).__regulusR3F?.scene.getObjectByName(object),
        ),
      `desk-hotspot-${seat}`,
    );
  // A placed room starts vanilla: one desk of four seats (D8).
  expect((await roomSettingsOf(page, operationId)).deskCount).toBe(1);
  expect(await desk("d2s1")).toBe(false);
  const rooms = page.getByRole("navigation", { name: "Rooms" });
  await rooms.getByRole("button", { name: "Room settings…" }).click();
  const panel = page.getByRole("dialog", { name: `Room settings: ${name}` });
  await panel.getByLabel("Desks (4 seats each)").selectOption("2");
  // The preview draws the new desk before it is saved...
  await expect(panel.getByText("The room shows your changes")).toBeVisible();
  await expect.poll(() => desk("d2s1"), { timeout: 15_000 }).toBe(true);
  // ...and Save keeps it.
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText("The room shows your changes")).toHaveCount(0);
  expect((await roomSettingsOf(page, operationId)).deskCount).toBe(2);
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => desk("d2s1")).toBe(true);
}
