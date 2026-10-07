/**
 * Wall pictures in the office e2e (#46): the owner gives the member view access to the room,
 * both walk in; the owner uploads a picture from "the PC" (a PNG the test draws), its ghost
 * follows the pointer (red over the boards, green on free wall), a click hangs it; the member's
 * scene shows it with its image without a reload; the owner selects it and removes it, and it
 * is gone for the member too. The member, with view access only, gets no "Hang a picture…".
 *
 * Reads pictures through the R3F scene (`window.__regulusR3F`, published with `?stats`).
 * With `E2E_SHOTS_DIR` set it also saves the screenshots for the PR (placing, on the wall;
 * night and day shift).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";
import { scenePoint } from "./agentProbes.ts";
import {
  cameraState,
  navPose,
  roomNamed,
  waitStill,
  walkInto,
  walkTo,
  walkToLobby,
  wheelZoomTo,
} from "./compoundProbes.ts";
import { waitForScene } from "./probes.ts";

/** A small PNG drawn here (a sunset over the sea): the test's own picture, nothing copied. */
export function sunsetPng(width = 160, height = 120): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      const sea = y > height * 0.62;
      const sun = (x - width * 0.5) ** 2 + (y - height * 0.6) ** 2 < (height * 0.18) ** 2;
      const t = y / height;
      const px: [number, number, number] = sea
        ? [20, 60 + Math.round(40 * t), 110 + Math.round(60 * t)]
        : sun
          ? [255, 210, 80]
          : [250 - Math.round(80 * t), 120 + Math.round(40 * t), 90 + Math.round(60 * t)];
      raw.set(px, i);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 255] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Pictures hung in the page's scene: decor id → whether its image has loaded. */
export const scenePictures = (page: Page): Promise<Record<string, boolean>> =>
  page.evaluate(() => {
    type Obj = {
      name: string;
      children: Obj[];
      material?: { map?: { image?: { width?: number } } | null };
      traverse(fn: (o: Obj) => void): void;
    };
    const r3f = (window as unknown as { __regulusR3F?: { scene: Obj } }).__regulusR3F;
    const out: Record<string, boolean> = {};
    r3f?.scene.traverse((o) => {
      const m = /^picture-([0-9a-f-]{36})$/.exec(o.name);
      if (!m?.[1]) return;
      let loaded = false;
      o.traverse((c) => {
        if (c.name === "picture-face") loaded = (c.material?.map?.image?.width ?? 0) > 0;
      });
      out[m[1]] = loaded;
    });
    return out;
  });

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(700);
    const shift = scheme === "dark" ? "night" : "day";
    await page.screenshot({ path: join(dir, `${name}-${shift}.jpg`), quality: 82, type: "jpeg" });
  }
  await page.emulateMedia({ colorScheme: null });
}

/** Sweep the pointer over the upper wall area until the ghost says it fits; the point, or null. */
async function aimAtFreeWall(page: Page): Promise<{ x: number; y: number } | null> {
  const status = page.getByTestId("picture-status");
  const view = page.viewportSize() ?? { width: 1280, height: 800 };
  for (let y = 110; y < view.height * 0.6; y += 25) {
    for (let x = 320; x < view.width - 300; x += 35) {
      await page.mouse.move(x, y);
      if ((await status.textContent()) === "Clear to hang.") return { x, y };
    }
  }
  return null;
}

export async function checkWallPictures(owner: Page, member: Page, operation: string) {
  const room = await roomNamed(owner, operation);
  const zoom = (await cameraState(owner)).wantZoom;
  // The member may look into the room, nothing more.
  const memberId = ((await (await member.request.get("/api/me")).json()) as { id: string }).id;
  const origin = new URL(owner.url()).origin;
  const grant = await owner.request.put(`/api/operations/${room.id}/members/${memberId}`, {
    data: { access: "view" },
    headers: { origin },
  });
  expect(grant.status(), await grant.text()).toBeLessThan(300);
  // The member's operation list (and with it room access) refreshes on reload.
  await member.reload();
  await waitForScene(member);
  await walkInto(member, operation);
  await owner.bringToFront();
  await walkInto(owner, operation);
  await expect(member.getByRole("button", { name: "Hang a picture…" })).toHaveCount(0);

  // Upload from the PC: the dock asks for a wall.
  await owner.getByTestId("picture-file").setInputFiles({
    name: "sunset.png",
    mimeType: "image/png",
    buffer: sunsetPng(),
  });
  const dock = owner.getByRole("dialog", { name: "Hang a picture" });
  await expect(dock).toBeVisible({ timeout: 30_000 });
  // Up close to the back wall, so the ghost and the picture fill the view.
  if (await walkTo(owner, room.x + room.w / 2, room.z + 2.6)) await waitStill(owner);
  await owner.mouse.move(640, 420);
  await wheelZoomTo(owner, 0.2);
  // Over the issue board (when it is in view) the ghost is red and says why.
  const view = owner.viewportSize() ?? { width: 1280, height: 800 };
  const board = await scenePoint(owner, "board-hotspot-issue-board");
  if (
    board &&
    board.x > 300 &&
    board.x < view.width - 300 &&
    board.y > 100 &&
    board.y < view.height - 150
  ) {
    await owner.mouse.move(board.x, board.y);
    await expect(owner.getByTestId("picture-status")).toHaveText(
      "It would cover a board or screen.",
    );
    await expect(dock.getByRole("button", { name: "Hang here (Enter)" })).toBeDisabled();
  }
  const spot = await aimAtFreeWall(owner);
  expect(spot, "no free wall under the pointer").not.toBeNull();
  if (!spot) return;
  await expect(dock.getByRole("button", { name: "Hang here (Enter)" })).toBeEnabled();
  await shot(owner, "01-placing");
  const before = Object.keys(await scenePictures(member));
  await owner.mouse.click(spot.x, spot.y);
  await expect(dock).toBeHidden();
  // The player did not walk off on that click.
  expect((await navPose(owner)).walking).toBe(false);

  // The member sees it, image and all, without a reload.
  let decorId = "";
  await expect
    .poll(
      async () => {
        const now = await scenePictures(member);
        decorId = Object.keys(now).find((id) => !before.includes(id)) ?? "";
        return decorId ? now[decorId] : false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect
    .poll(async () => (await scenePictures(owner))[decorId], { timeout: 30_000 })
    .toBe(true);
  await owner.mouse.move(10, 400);
  await shot(owner, "02-on-wall");

  // The owner selects it (a click on it) and removes it; it is gone for the member too.
  const at = await scenePoint(owner, `picture-${decorId}`);
  if (!at) throw new Error("picture not on screen");
  await owner.mouse.click(at.x, at.y);
  const editing = owner.getByRole("dialog", { name: "Picture" });
  await expect(editing).toBeVisible();
  await shot(owner, "03-selected");
  await editing.getByRole("button", { name: "Remove (Del)" }).click();
  await expect(editing).toBeHidden();
  await expect
    .poll(async () => decorId in (await scenePictures(member)), { timeout: 30_000 })
    .toBe(false);
  // The owner's own scene follows the same room state on its next render: wait for it like
  // for the member's, instead of reading it once (the race of #232).
  await expect
    .poll(async () => decorId in (await scenePictures(owner)), { timeout: 30_000 })
    .toBe(false);

  // Back out, the camera as it was.
  await owner.mouse.move(640, 420);
  await wheelZoomTo(owner, zoom);
  await walkToLobby(member);
  await walkToLobby(owner);
}
