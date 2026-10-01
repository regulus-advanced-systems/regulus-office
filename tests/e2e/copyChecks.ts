/**
 * Copying out of every terminal surface (#164), with the clipboard read back each time:
 * the henchman's terminal (watch and control), the live laptop panel on the desk, and the
 * login terminal. Each surface is checked for drag-select, Ctrl+Shift+C, right-click → Copy,
 * the "Copy selection" / "Copy screen" buttons and the "Copied" flash; the henchman's terminal
 * also with the Clipboard API refused (the copy-command fallback must still copy).
 *
 * The fake `claude` turns on mouse tracking like Claude Code does, so these fail if a drag is
 * reported to the program instead of selecting text.
 */
import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";
import { navPose, walkUpToDesk } from "./compoundProbes.ts";
import { laptopClickPoint } from "./deskProbes.ts";
import { type Box, dragAcrossTop, readClipboard, writeClipboard } from "./terminalChecks.ts";

/** Claude Code's mouse tracking request (any-event), as the fake sends it. */
const MOUSE_ON = "\x1b[?1003h";

const screenBox = async (root: Locator): Promise<Box> => {
  const box = await root.locator(".xterm-screen").first().boundingBox();
  if (!box) throw new Error("terminal screen not rendered");
  return box;
};

/** Runs `action` with a known clipboard and returns what it left there after "Copied". */
async function copied(page: Page, root: Locator, label: string, action: () => Promise<void>) {
  const before = `before ${label}`;
  await writeClipboard(page, before);
  await action();
  await expect(root.getByTestId("terminal-flash"), label).toHaveText("Copied");
  await expect.poll(() => readClipboard(page), { message: label }).not.toBe(before);
  // The flash goes before the next action, so each one is seen on its own.
  await expect(root.getByTestId("terminal-flash")).toHaveCount(0, { timeout: 5_000 });
  return readClipboard(page);
}

/**
 * Drag, Ctrl+Shift+C, right-click → Copy, "Copy selection" and "Copy screen" in one
 * terminal box. Returns the copied screen text.
 */
export async function checkCopyEveryWay(page: Page, root: Locator): Promise<string> {
  const selected = await copied(page, root, "drag", async () =>
    dragAcrossTop(page, await screenBox(root)),
  );
  expect(selected).toMatch(/\S/);
  // The selection is still there: the keys, the menu and the button copy the same text.
  const keys = await copied(page, root, "Ctrl+Shift+C", () =>
    page.keyboard.press("Control+Shift+C"),
  );
  expect(keys).toBe(selected);
  const menu = await copied(page, root, "right-click Copy", async () => {
    const box = await screenBox(root);
    await page.mouse.click(box.x + 20, box.y + 8, { button: "right" });
    await root.getByRole("menuitem", { name: "Copy" }).click();
  });
  expect(menu).toBe(selected);
  const button = await copied(page, root, "Copy selection", () =>
    root.getByTestId("terminal-copy-selection").click(),
  );
  expect(button).toBe(selected);
  const screen = await copied(page, root, "Copy screen", () =>
    root.getByTestId("terminal-copy-screen").click(),
  );
  await expect(root.getByTestId("terminal-copy-failed")).toHaveCount(0);
  return screen;
}

/**
 * The henchman's terminal, watching and in control. `open` opens it; `stream` is what the
 * page's terminal sockets received (proof the program asked for mouse tracking).
 */
export async function checkHenchmanTerminalCopy(
  page: Page,
  context: BrowserContext,
  open: () => Promise<void>,
  stream: () => string,
): Promise<void> {
  await open();
  const dialog = page.getByRole("dialog").filter({ hasText: /In control|Watching/ });
  await expect(dialog.getByTestId("terminal-screen")).toHaveAttribute("data-status", "open");
  // The program asked for mouse reports, and the terminal still selects on a drag.
  await expect.poll(() => stream().includes(MOUSE_ON)).toBe(true);
  await expect(dialog.locator(".xterm")).not.toHaveClass(/enable-mouse-events/);

  expect(await checkCopyEveryWay(page, dialog)).toContain("FAKE CLAUDE DONE");

  // The browser refuses the Clipboard API: the copy command still puts the text there.
  await writeClipboard(page, "before refused");
  await context.clearPermissions();
  try {
    await dialog.getByTestId("terminal-copy-screen").click();
    await expect(dialog.getByTestId("terminal-flash")).toHaveText("Copied");
    await expect(dialog.getByTestId("terminal-copy-failed")).toHaveCount(0);
  } finally {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  expect(await readClipboard(page)).toContain("FAKE CLAUDE DONE");
  await expect(dialog.getByTestId("terminal-flash")).toHaveCount(0, { timeout: 5_000 });

  // In control a drag selects too (it is not sent to the program), and the keys copy.
  const sent: string[] = [];
  page.on("websocket", (ws) => {
    if (!new URL(ws.url()).pathname.startsWith("/ws/term/")) return;
    ws.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") sent.push(payload.toString("utf8"));
    });
  });
  await dialog.getByRole("button", { name: "Take control" }).click();
  await expect(dialog.getByTestId("terminal-mode")).toHaveText("In control");
  await expect(dialog.getByTestId("terminal-screen")).toHaveAttribute("data-status", "open");
  await page.waitForTimeout(500); // tmux redraws at the controller's size
  expect(await checkCopyEveryWay(page, dialog)).toContain("FAKE CLAUDE");
  expect(sent.join("")).not.toContain("\x1b[<0;"); // no mouse button report from the drags
  // The wheel still scrolls a program that asked for mouse reports (SGR wheel up).
  const box = await screenBox(dialog);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => sent.join("")).toMatch(/\x1b\[<64;\d+;\d+M/);
  await dialog.getByRole("button", { name: "Release control" }).click();
  await expect(dialog.getByTestId("terminal-mode")).toHaveText("Watching");
  await dialog.getByRole("button", { name: /Close/ }).first().click();
  await expect(dialog).toHaveCount(0);
}

/**
 * The live laptop panel: the player walks up to the henchman's desk, the laptop shows the live
 * terminal, which is display-only (under the 3D canvas, a few pixels wide in the 3/4 view).
 * `E` at the desk and a click on the laptop both open the henchman's terminal, where copying works.
 *
 * Each step waits for a state, not a moment or a screen position (#199, #205): the walk-up
 * goes by nav state (compoundProbes.ts `walkUpToDesk`) until the player stands where `E`
 * opens this desk, which is exactly where the live panel shows (one rule for both, #205);
 * then a point where the laptop is the nearest clickable object (the seated henchman hides most
 * of it).
 */
export async function checkLaptopCopy(page: Page, seatId: string): Promise<void> {
  const live = page.getByTestId("laptop-live-terminal");
  const panel = page.locator("section.rg-agent-panel");
  if (await panel.isVisible()) await panel.getByRole("button", { name: /Close/ }).first().click();
  await expect(panel).toHaveCount(0);
  const operationId = (await navPose(page)).operationId;
  if (!operationId) throw new Error("not in the henchman's room");
  await walkUpToDesk(page, operationId, seatId);
  // Standing at the desk: the laptop shows the live terminal.
  await expect(live).toHaveCount(1);
  await expect(live.locator(".xterm-screen")).toHaveCount(1);

  const dialog = page.getByRole("dialog").filter({ hasText: /In control|Watching/ });
  const closeDialog = async () => {
    await dialog.getByRole("button", { name: /Close/ }).first().click();
    await expect(dialog).toHaveCount(0);
  };
  // E at the desk opens the henchman's terminal.
  await page.keyboard.press("e");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("terminal-screen")).toHaveAttribute("data-status", "open");
  await closeDialog();

  // So does a click on the laptop, where no henchman or furniture is in front of it.
  await expect(live).toHaveCount(1);
  const point = await laptopClickPoint(page, seatId);
  expect(point, "a visible part of the laptop to click").not.toBeNull();
  if (point) await page.mouse.click(point.x, point.y);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("terminal-screen")).toHaveAttribute("data-status", "open");
  const screen = await copied(page, dialog, "laptop → Copy screen", () =>
    dialog.getByTestId("terminal-copy-screen").click(),
  );
  expect(screen).toContain("FAKE CLAUDE DONE");
  await closeDialog();
}

/**
 * The login terminal (Settings → Office → Connect providers → Claude Code): the fake prints a sign-in
 * link and waits for a code. Copy every way, then paste a code to finish the sign-in.
 */
export async function checkLoginTerminalCopy(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Office" }).click();
  await page.getByRole("button", { name: "Connect providers" }).click();
  const panel = page.getByRole("dialog", { name: "Connect providers" });
  const claude = panel.locator('[data-provider="claude-code"]');
  await claude.getByRole("button", { name: /Sign in again|Connect/ }).click();
  const terminal = panel.locator(".rg-providers__terminal");
  await expect(terminal.getByTestId("login-terminal")).toHaveAttribute("data-status", "open");
  // The sign-in link reached the terminal (the bar reads it from the terminal).
  await expect(terminal.getByText(/claude\.ai\/oauth\/authorize/).first()).toBeVisible();

  const screen = await checkCopyEveryWay(page, terminal);
  expect(screen).toContain("https://claude.ai/oauth/authorize?code=true");

  // Paste a code (right-click → Paste) and press Enter: the fake reads it and signs in.
  await writeClipboard(page, "fake-code-164");
  const box = await screenBox(terminal);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, { button: "right" });
  await terminal.getByRole("menuitem", { name: "Paste" }).click();
  // The paste hands focus back to the terminal once the clipboard was read.
  await expect(terminal.locator("textarea.xterm-helper-textarea")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(claude.getByText("Signed in.")).toBeVisible({ timeout: 30_000 });
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toHaveCount(0);
}
