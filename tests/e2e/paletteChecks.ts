/**
 * The command palette in a real browser (#261): Ctrl+K opens it from the scene and not from
 * a text field or under an open dialog; it is worked by keyboard alone (type, Enter); what
 * it offers follows who is asking (build mode is the owner's, not the member's); and a
 * picked room is travelled to. Then the two things that have their own Ctrl+K, as they
 * really are in the page: the whiteboard (office e2e) and a henchman's terminal (agents e2e).
 *
 * With `E2E_SHOTS_DIR` set it also saves the screenshots for the PR.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, type WebSocket } from "@playwright/test";
import { navPose, waitStill, walkTo, walkToLobby } from "./compoundProbes.ts";
import { dialogSettled } from "./dialogLayout.ts";
import { distance } from "./probes.ts";
import { backToLobbyMiddle } from "./socialChecks.ts";
import { boardIds, drawRectangle, openLobbyBoard } from "./whiteboardChecks.ts";

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  // Past the dialog's pop-in, or the picture is of the scene alone.
  const dialog = page.getByRole("dialog").last();
  if (await dialog.count()) await dialogSettled(page, dialog);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, `${name}.jpg`), quality: 82, type: "jpeg" });
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const box = (page: Page) => page.getByTestId("palette-input");
const rows = (page: Page) => page.getByTestId("palette-list").getByRole("option");
const blur = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

export async function checkCommandPalette(owner: Page, member: Page): Promise<void> {
  await owner.bringToFront();

  // A text field keeps Ctrl+K: nothing opens and what was typed is still there.
  const chat = owner.getByTestId("chat-input");
  await chat.fill("typing here");
  await chat.press("Control+k");
  await expect(palette(owner)).toHaveCount(0);
  await expect(chat).toHaveValue("typing here");
  await chat.fill("");
  await chat.press("Escape");
  await blur(owner);

  // So does an open dialog.
  await owner.keyboard.press("?");
  const help = owner.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help).toContainText("Ctrl+K");
  await owner.keyboard.press("Control+k");
  await expect(palette(owner)).toHaveCount(0);
  await expect(help).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  // From the scene it opens, with the keyboard in its text field.
  await owner.keyboard.press("Control+k");
  await expect(palette(owner)).toBeVisible();
  await expect(box(owner)).toBeFocused();
  await expect(rows(owner).filter({ hasText: "Go to Lobby" })).toBeVisible();
  await shot(owner, "palette-open");

  // The owner may build; typing finds it.
  await owner.keyboard.type("new operation");
  await expect(rows(owner).first()).toContainText("New operation (build mode)");
  await shot(owner, "palette-filtered");

  // Keyboard only: type, Enter, and Settings is open on that tab.
  await box(owner).fill("");
  await owner.keyboard.type("display");
  await expect(rows(owner).first()).toContainText("Settings: Display and sound");
  await owner.keyboard.press("Enter");
  await expect(palette(owner)).toHaveCount(0);
  const settings = owner.getByRole("dialog", { name: "Settings", exact: true });
  await expect(
    settings.getByRole("tab", { name: "Display and sound", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await owner.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  // Ctrl+K again closes it.
  await blur(owner);
  await owner.keyboard.press("Control+k");
  await expect(palette(owner)).toBeVisible();
  await owner.keyboard.press("Control+k");
  await expect(palette(owner)).toHaveCount(0);

  // The member is not offered build mode, nor the owners' Settings tabs.
  await member.bringToFront();
  await blur(member);
  await member.keyboard.press("Control+k");
  await expect(box(member)).toBeFocused();
  await member.keyboard.type("new operation");
  await expect(rows(member)).toHaveCount(1);
  await expect(rows(member).first()).toContainText("Search chat and terminals for");
  await box(member).fill("settings");
  await expect(rows(member).filter({ hasText: "Settings: You" })).toBeVisible();
  await expect(rows(member).filter({ hasText: "Settings: Office" })).toHaveCount(0);

  // A room: Enter, and the member stands at its door.
  const before = await navPose(member);
  // (The lobby's own door: near enough to walk back from at a software-GL frame rate.)
  await box(member).fill("go to lobby");
  await expect(rows(member).first()).toContainText("Go to Lobby");
  await member.keyboard.press("Enter");
  await expect(palette(member)).toHaveCount(0);
  await expect
    .poll(async () => distance(await navPose(member), before), { timeout: 15_000 })
    .toBeGreaterThan(2);
  // Back where the member was: later steps start in the lobby.
  await walkToLobby(member);
  await backToLobbyMiddle(member);
}

const board = (page: Page) => page.getByRole("dialog", { name: "Whiteboard: Lobby" });
/** Where the test's shape is drawn, as a fraction of the board's area (its top-left corner). */
const SHAPE_AT = 0.42;

/**
 * The real whiteboard keeps Ctrl+K: with a shape selected Excalidraw opens its link editor,
 * and the palette stays shut. The shape is removed again and the player walks back.
 */
export async function checkWhiteboardKeepsCtrlK(page: Page): Promise<void> {
  const home = await navPose(page);
  await openLobbyBoard(page);
  const before = (await boardIds(page)).length;
  // A drawn shape stays selected, which is when Ctrl+K means "link" to Excalidraw.
  await drawRectangle(page, SHAPE_AT, SHAPE_AT);
  await expect.poll(async () => (await boardIds(page)).length).toBe(before + 1);
  await page.keyboard.press("Control+k");
  await expect(page.locator(".excalidraw-hyperlinkContainer")).toBeVisible();
  await expect(palette(page)).toHaveCount(0);
  await shot(page, "whiteboard-keeps-ctrl-k");
  // Clean up: out of the link editor, then the shape (picked by its top edge) is deleted.
  await page.keyboard.press("Escape");
  await expect(board(page)).toBeVisible();
  const area = await board(page).locator(".rg-whiteboard__body").boundingBox();
  if (!area) throw new Error("no board area");
  await page.mouse.click(area.x + area.width * SHAPE_AT + 60, area.y + area.height * SHAPE_AT);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await boardIds(page)).length).toBe(before);
  await page.getByRole("button", { name: "Close whiteboard" }).click();
  await expect(board(page)).toBeHidden();
  // With the board shut the chord is the palette's again.
  await blur(page);
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await walkTo(page, home.x, home.z);
  await waitStill(page);
}

/**
 * The real terminal keeps Ctrl+K (agents e2e: a henchman's tmux through xterm.js). In control,
 * with the keyboard in the terminal, the chord is sent down the terminal socket as the byte
 * 0x0B (what a shell reads as "kill to the end of the line") and the palette stays shut.
 * `open` opens the henchman's terminal.
 */
export async function checkTerminalKeepsCtrlK(
  page: Page,
  open: () => Promise<void>,
): Promise<void> {
  const sent: number[][] = [];
  const listen = (ws: WebSocket) => {
    if (!new URL(ws.url()).pathname.startsWith("/ws/term/")) return;
    ws.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") sent.push([...payload]);
    });
  };
  page.on("websocket", listen);
  try {
    await page.bringToFront();
    await open();
    const terminal = page.getByRole("dialog").filter({ hasText: /In control|Watching/ });
    await expect(terminal.getByTestId("terminal-screen")).toHaveAttribute("data-status", "open");
    // Watching: the terminal window is open, so the chord is not the palette's.
    await page.keyboard.press("Control+k");
    await expect(palette(page)).toHaveCount(0);
    await terminal.getByRole("button", { name: "Take control" }).click();
    await expect(terminal.getByTestId("terminal-mode")).toHaveText("In control");
    await terminal.locator(".xterm-screen").click();
    await expect(terminal.locator(".xterm-helper-textarea")).toBeFocused();
    sent.length = 0;
    await page.keyboard.press("Control+k");
    await expect
      .poll(() => sent.some((frame) => frame.length === 1 && frame[0] === 0x0b))
      .toBe(true);
    await expect(palette(page)).toHaveCount(0);
    await expect(terminal).toBeVisible();
    await shot(page, "terminal-keeps-ctrl-k");
    await terminal.getByRole("button", { name: "Release control" }).click();
    await expect(terminal.getByTestId("terminal-mode")).toHaveText("Watching");
    await terminal.getByRole("button", { name: /Close/ }).first().click();
    await expect(terminal).toHaveCount(0);
  } finally {
    page.off("websocket", listen);
  }
}
