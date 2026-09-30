/**
 * Terminal checks for the agents e2e (#156): the terminal box and the xterm
 * screen inside it, a mouse drag over the text, the clipboard, and the whole
 * robot-terminal step ({@link checkRobotTerminal}).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { insideViewport, settledDialogLayout } from "./dialogLayout.ts";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The terminal box and the rendered xterm screen (the grid at its current font) inside it. */
export async function terminalFit(dialog: Locator): Promise<{ box: Box; screen: Box }> {
  return dialog.evaluate((frame) => {
    const rect = (el: Element | null): Box => {
      const r = el?.getBoundingClientRect();
      return { x: r?.x ?? 0, y: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 };
    };
    return {
      box: rect(frame.querySelector('[data-testid="terminal-screen"]')),
      screen: rect(frame.querySelector(".xterm-screen")),
    };
  });
}

/** `inner` lies within `outer` (1 px slack), and fills it in at least one direction. */
export function fitsAndFills(inner: Box, outer: Box, fill = 0.9): boolean {
  const within =
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1;
  return within && (inner.width >= outer.width * fill || inner.height >= outer.height * fill);
}

/** `a` is larger than `b` (cell widths round to whole pixels, so one side may stay the same). */
export const bigger = (a: Box, b: Box): boolean =>
  a.width >= b.width && a.height >= b.height && a.width * a.height > b.width * b.height;

/** Drags across the top rows of the terminal, like selecting text with the mouse. */
export async function dragAcrossTop(page: Page, screen: Box, rows = 3): Promise<void> {
  const lineHeight = screen.height / 45;
  await page.mouse.move(screen.x + 2, screen.y + 2);
  await page.mouse.down();
  await page.mouse.move(screen.x + screen.width - 4, screen.y + lineHeight * rows, { steps: 8 });
  await page.mouse.up();
}

export const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() => navigator.clipboard.readText());

export const writeClipboard = (page: Page, text: string): Promise<void> =>
  page.evaluate((t) => navigator.clipboard.writeText(t), text);

/**
 * The robot's terminal at 1920x1080: expand (about 60 % of the window, layout rules of #149
 * kept, the watcher's grid scaled to fit), select text and find it on the clipboard, take
 * control and see tmux reflow (within 160x45), release and see the window restored.
 * `windowSize` reads the agent's tmux window as "COLSxROWS"; `open` opens the terminal.
 */
export async function checkRobotTerminal(
  page: Page,
  windowSize: () => string,
  open: () => Promise<void>,
): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 });
  try {
    await open();
    const terminal = page.getByRole("dialog").filter({ hasText: /In control|Watching/ });
    await expect(terminal.getByTestId("terminal-mode")).toHaveText("Watching");
    await expect(terminal.getByTestId("terminal-screen")).toHaveAttribute("data-status", "open");
    // The watcher's grid has been scaled into the normal box before it is measured.
    await expect
      .poll(async () => {
        const fit = await terminalFit(terminal);
        return fitsAndFills(fit.screen, fit.box, 0.8) || `screen ${JSON.stringify(fit)}`;
      })
      .toBe(true);
    const normal = await terminalFit(terminal);

    // Expand: about 60 % of the window (1152x648 at 1920x1080), the modal layout rules hold.
    await terminal.getByTestId("terminal-expand").click();
    await expect.poll(async () => (await terminalFit(terminal)).box.height).toBe(648);
    const expanded = await terminalFit(terminal);
    expect(expanded.box.width).toBe(1152);
    expect(expanded.box.width).toBeGreaterThan(normal.box.width);
    // A watcher's fixed 160x45 grid is scaled to fit the bigger box (letterboxed, not cut).
    // The font steps by 0.25 px and cell sizes round, so "fills" allows some slack.
    await expect
      .poll(async () => {
        const fit = await terminalFit(terminal);
        const ok = fitsAndFills(fit.screen, fit.box, 0.8) && bigger(fit.screen, normal.screen);
        return ok || `screen ${JSON.stringify(fit.screen)} in box ${JSON.stringify(fit.box)}`;
      })
      .toBe(true);
    const layout = await settledDialogLayout(page, terminal);
    expect(insideViewport(layout)).toBe(true);
    expect(layout.closeHittable).toBe(true);
    expect(layout.horizontalOverflow).toEqual([]);
    // Watching never reshapes the agent's window (160x45 less tmux's status line).
    const agentSize = windowSize();
    expect(agentSize).toMatch(/^160x4[45]$/);

    // Selecting text copies it, for a watcher too.
    await writeClipboard(page, "nothing yet");
    await dragAcrossTop(page, (await terminalFit(terminal)).screen);
    await expect(terminal.getByTestId("terminal-flash")).toHaveText("Copied");
    await expect.poll(() => readClipboard(page)).toMatch(/\S/);
    expect(await readClipboard(page)).not.toBe("nothing yet");

    // In control the terminal fills the box at a readable size and tmux reflows to it
    // (never past the agent's 160x45); releasing control puts the window back.
    await terminal.getByRole("button", { name: "Take control" }).click();
    await expect(terminal.getByTestId("terminal-mode")).toHaveText("In control");
    await expect.poll(windowSize).not.toBe(agentSize);
    const [cols = 0, rows = 0] = windowSize().split("x").map(Number);
    expect(cols).toBeGreaterThan(100);
    expect(cols).toBeLessThanOrEqual(160);
    expect(rows).toBeLessThanOrEqual(45);
    await terminal.getByRole("button", { name: "Release control" }).click();
    await expect(terminal.getByTestId("terminal-mode")).toHaveText("Watching");
    await expect.poll(windowSize).toBe(agentSize);

    // Back to the normal size (remembered per user, so the next test starts from it).
    await terminal.getByTestId("terminal-expand").click();
    await expect.poll(async () => (await terminalFit(terminal)).box.height).toBe(normal.box.height);
    await terminal.getByRole("button", { name: /Close/ }).first().click();
    await expect(terminal).toHaveCount(0);
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
  }
}
