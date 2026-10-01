/**
 * Build mode in the e2e flows (#187): read the ghost through
 * `window.__regulusBuild` (published with `?stats`, apps/web/src/ui/build-mode),
 * aim it with the real mouse at a compound spot, and add a project room the
 * way an owner does: Add floor, Choose a spot…, then build on the map.
 */
import { expect, type Page } from "@playwright/test";
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

/** Move the mouse over the compound point (metres) so the ghost's middle lands there. */
export async function aimAt(page: Page, x: number, z: number): Promise<void> {
  const at = await screenPointOf(page, { x, z });
  if (!at) throw new Error("no camera");
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y, { steps: 3 });
}

/** Metres of a placement's middle (1 tile = 2 m). */
export const middleOf = (p: Placement) => ({
  x: (p.gridX + p.width / 2) * 2,
  z: (p.gridY + p.depth / 2) * 2,
});

/** Open Add floor, name the floor and its repo, and continue into build mode. */
export async function openBuildMode(page: Page, name: string, repo: string): Promise<BuildProbe> {
  const rooms = page.getByRole("navigation", { name: "Rooms" });
  await rooms.getByRole("button", { name: "Add floor…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add floor" });
  await dialog.getByLabel("Floor name").fill(name);
  await dialog.getByLabel("Repo 1", { exact: true }).fill(repo);
  await dialog.getByRole("button", { name: "Choose a spot…" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: `Build ${name}` })).toBeVisible();
  return settledVerdict(page);
}

/** A room's settings as the server has them (#182). */
export async function roomSettingsOf(
  page: Page,
  floorId: string,
): Promise<{ deskCount: number; decorStyle: string }> {
  const res = await page.request.get(`/api/floors/${encodeURIComponent(floorId)}/room-settings`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { deskCount: number; decorStyle: string };
}

/**
 * In a room the page manages: Room settings, one more desk (D8 rooms start
 * with one), previewed live before Save, kept after it.
 */
export async function addDeskInRoomSettings(page: Page, floorId: string, name: string) {
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
  expect((await roomSettingsOf(page, floorId)).deskCount).toBe(1);
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
  expect((await roomSettingsOf(page, floorId)).deskCount).toBe(2);
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => desk("d2s1")).toBe(true);
}
