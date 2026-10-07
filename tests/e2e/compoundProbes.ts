/**
 * Walking the compound in the e2e flows (#186): read the player's nav state through
 * `window.__regulusNav` (published with `?stats`, apps/web/src/scene/compound/navProbe.ts)
 * and walk by state, never by a screen position. `walkTo` does what a floor click does
 * (A* across corridors and through doors); the flows wait for where the player ends up
 * (the room under them, the room the HUD shows), whatever the page's frame rate.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export interface NavPose {
  x: number;
  z: number;
  heading: number;
  spawned: boolean;
  walking: boolean;
  room: string | null;
  operationId: string | null;
}

export interface NavRoom {
  id: string;
  name: string;
  kind: string;
  enterable: boolean;
  buildState: string;
  x: number;
  z: number;
  w: number;
  d: number;
  /** A walkable point just inside the door (a special room's middle). */
  inside: { x: number; z: number };
}

interface Nav {
  pose(): NavPose;
  rooms(): NavRoom[];
  seat(operationId: string, seatId: string): { x: number; z: number } | null;
  walkTo(x: number, z: number): boolean;
  walkToSeat(operationId: string, seatId: string): boolean;
  terminalDesk(): string | null;
  camera(): CameraState;
  level(): string;
  levelOf(roomName: string): { levelId: string; name: string } | null;
}

export interface CameraState {
  yaw: number;
  wantYaw: number;
  zoom: number;
  wantZoom: number;
  distance: number;
}

function probe(): Nav {
  const n = (window as unknown as { __regulusNav?: Nav }).__regulusNav;
  if (!n) throw new Error("no __regulusNav (open the page with ?stats)");
  return n;
}

export const navPose = (page: Page): Promise<NavPose> =>
  page.evaluate(`(${probe.toString()})().pose()`) as Promise<NavPose>;
export const navRooms = (page: Page): Promise<NavRoom[]> =>
  page.evaluate(`(${probe.toString()})().rooms()`) as Promise<NavRoom[]>;
/** The desk `E` would open the terminal of, here and now (the live laptop panel's rule). */
export const terminalDesk = (page: Page): Promise<string | null> =>
  page.evaluate(`(${probe.toString()})().terminalDesk()`) as Promise<string | null>;
/** The 3/4 camera's shown and requested yaw and zoom. */
export const cameraState = (page: Page): Promise<CameraState> =>
  page.evaluate(`(${probe.toString()})().camera()`) as Promise<CameraState>;

/** Wait until the camera has eased to the yaw and zoom asked for; returns that state. */
export async function cameraSettled(page: Page): Promise<CameraState> {
  await expect
    .poll(async () => {
      const c = await cameraState(page);
      return Math.abs(c.yaw - c.wantYaw) + Math.abs(c.zoom - c.wantZoom);
    })
    .toBeLessThan(0.002);
  return cameraState(page);
}

/** Turn the mouse wheel over the scene until the camera asks for `zoom` (0 close .. 1 overview). */
export async function wheelZoomTo(page: Page, zoom: number): Promise<CameraState> {
  for (let i = 0; i < 80; i++) {
    const want = (await cameraState(page)).wantZoom;
    if (Math.abs(want - zoom) <= 0.02) break;
    await page.mouse.wheel(0, Math.max(-200, Math.min(200, (zoom - want) / 0.0008)));
  }
  return cameraSettled(page);
}

/** Walk to a compound point, like a click on the floor there; true when a path exists. */
export const walkTo = (page: Page, x: number, z: number): Promise<boolean> =>
  page.evaluate(`(${probe.toString()})().walkTo(${x}, ${z})`) as Promise<boolean>;
/** Walk up behind a desk's chair; true when a path exists. */
export const walkToSeat = (page: Page, operationId: string, seatId: string): Promise<boolean> =>
  page.evaluate(
    `(${probe.toString()})().walkToSeat(${JSON.stringify(operationId)}, ${JSON.stringify(seatId)})`,
  ) as Promise<boolean>;

/** The level the page is looking at (#268). */
export const navLevel = (page: Page): Promise<string> =>
  page.evaluate(`(${probe.toString()})().level()`) as Promise<string>;

/**
 * Look at the level the room called `name` is on (#268): a room is on the level of its
 * repo's owner, and the world shows one level at a time. Through quick travel's level list,
 * as a person would; the player arrives at that level's lobby door. False when the room (or
 * its level) is not published yet; true once the page is on that level.
 */
export async function goToLevelOf(page: Page, name: string): Promise<boolean> {
  const target = (await page.evaluate(
    `(${probe.toString()})().levelOf(${JSON.stringify(name)})`,
  )) as { levelId: string; name: string } | null;
  if (!target) return false;
  await goToLevel(page, target);
  return true;
}

/** Look at the shared lobby level (where everyone arrives; it has no project rooms). */
export const goToLobbyLevel = (page: Page): Promise<void> =>
  goToLevel(page, { levelId: "lobby", name: "Lobby" });

async function goToLevel(page: Page, target: { levelId: string; name: string }): Promise<void> {
  if ((await navLevel(page)) === target.levelId) return;
  await page.bringToFront();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const dialog = page.getByRole("dialog", { name: "Quick travel" });
  if ((await dialog.count()) === 0) await page.keyboard.press("f");
  await dialog
    .getByRole("list", { name: "Levels" })
    .getByRole("button", { name: new RegExp(`^${target.name}`) })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => navLevel(page)).toBe(target.levelId);
}

/**
 * The room called `name`, once it is finished and this page may enter it. The page is taken
 * to the room's level first, if it is looking at another one.
 */
export async function roomNamed(page: Page, name: string): Promise<NavRoom> {
  let found: NavRoom | undefined;
  await expect
    .poll(
      async () => {
        found = (await navRooms(page)).find((r) => r.name === name);
        if (!found && (await goToLevelOf(page, name)))
          found = (await navRooms(page)).find((r) => r.name === name);
        return found ? `${found.buildState}/${found.enterable}` : "missing";
      },
      { timeout: 45_000 },
    )
    .toBe("ready/true");
  if (!found) throw new Error(`room ${name} missing`);
  return found;
}

/** Wait until the player stands still (the walk ended). */
export async function waitStill(page: Page, timeout = 60_000): Promise<NavPose> {
  await expect.poll(async () => (await navPose(page)).walking, { timeout }).toBe(false);
  return navPose(page);
}

/**
 * Walk from wherever the player is into `name` (through the corridors, its door opening on
 * the way), on to the middle of the room so all of it is in view, and wait until the HUD is
 * in that room with its OperationRoom state in.
 */
export async function walkInto(page: Page, name: string): Promise<NavRoom> {
  const room = await roomNamed(page, name);
  await expect(async () => {
    const pose = await navPose(page);
    if (pose.room === room.id && pose.operationId === room.id) return;
    if (!pose.walking) expect(await walkTo(page, room.inside.x, room.inside.z)).toBe(true);
    throw new Error(`walking into ${name}`);
  }).toPass({ timeout: 90_000, intervals: [500, 1_000] });
  // On to the middle (the nearest free spot to it, like a click on a desk there).
  if (await walkTo(page, room.x + room.w / 2, room.z + room.d / 2)) await waitStill(page);
  await expect(page.locator(".rg-topbar__operation")).toHaveText(name);
  await expect(page.getByRole("list", { name: "Work in this operation" })).toBeVisible();
  return room;
}

/** Walk back out to the lobby. */
export async function walkToLobby(page: Page): Promise<void> {
  const lobby = (await navRooms(page)).find((r) => r.kind === "lobby");
  if (!lobby) throw new Error("no lobby");
  await expect(async () => {
    const pose = await navPose(page);
    if (pose.room === lobby.id) return;
    if (!pose.walking) await walkTo(page, lobby.inside.x, lobby.inside.z);
    throw new Error("walking to the lobby");
  }).toPass({ timeout: 90_000, intervals: [500, 1_000] });
  await expect(page.locator(".rg-topbar__operation")).toHaveText("Lobby");
}

/** Quick travel (`F`) to a room's door, then walk in. */
export async function travelInto(page: Page, name: string): Promise<NavRoom> {
  await page.bringToFront();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("f");
  const dialog = page.getByRole("dialog", { name: "Quick travel" });
  await dialog
    .getByRole("list", { name: "Rooms you can enter" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  await expect(dialog).toHaveCount(0);
  return walkInto(page, name);
}

/**
 * Walk up to a henchman's desk by nav state (#205): to just behind its chair, until the player
 * stands still where `E` opens that desk's terminal (the rule the live laptop panel follows
 * too, so wherever the panel shows, `E` reaches).
 */
export async function walkUpToDesk(page: Page, operationId: string, seatId: string): Promise<void> {
  await expect(async () => {
    const pose = await navPose(page);
    if (!pose.walking && (await terminalDesk(page)) === seatId) return;
    if (!pose.walking) expect(await walkToSeat(page, operationId, seatId)).toBe(true);
    throw new Error(`walking to desk ${seatId}`);
  }).toPass({ timeout: 60_000, intervals: [500, 1_000] });
}

/** Where an object of the scene is: its screen point and its ground point (compound metres). */
function scenePlace(
  page: Page,
  name: string,
): Promise<{ x: number; y: number; wx: number; wz: number } | null> {
  return page.evaluate((n) => {
    type V = { x: number; y: number; z: number; clone(): V; project(c: unknown): V };
    type Obj = { position: V; getWorldPosition(v: V): V };
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          scene: { getObjectByName(n: string): Obj | undefined };
          get(): { camera: unknown; gl: { domElement: HTMLCanvasElement } };
        };
      }
    ).__regulusR3F;
    const o = r3f?.scene.getObjectByName(n);
    if (!r3f || !o) return null;
    const { camera, gl } = r3f.get();
    const rect = gl.domElement.getBoundingClientRect();
    const w = o.getWorldPosition(o.position.clone());
    const p = w.clone().project(camera);
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
      wx: w.x,
      wz: w.z,
    };
  }, name);
}

/**
 * Click a scene object (a board's or the queue clipboard's hotspot, say) until `opens` shows.
 * When the object is not well inside the view (off screen, or under the HUD), the player
 * first walks over to it, as someone would, so the camera brings it into view.
 */
export async function clickInScene(page: Page, name: string, opens: Locator): Promise<void> {
  await expect(async () => {
    if (await opens.isVisible()) return;
    const at = await scenePlace(page, name);
    if (!at) throw new Error(`${name} is not in the scene`);
    const view = page.viewportSize() ?? { width: 1280, height: 800 };
    const inside = at.x > 300 && at.x < view.width - 280 && at.y > 140 && at.y < view.height - 180;
    if (!inside) {
      if (!(await navPose(page)).walking) await walkTo(page, at.wx, at.wz);
      throw new Error(`walking over to ${name}`);
    }
    await page.mouse.click(at.x, at.y);
    await expect(opens).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000, intervals: [500, 1_000] });
}
