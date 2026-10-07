/**
 * The board window is wide (#282): with the open issue board on screen, at
 * 1280×720 and at the flow's own size, the window fits with its X in view,
 * nothing but the board itself scrolls sideways, every column keeps a
 * readable width and the card's title shows in full on at most three lines.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { insideViewport, settledDialogLayout } from "./dialogLayout.ts";

/** Narrowest a column may get before the board scrolls sideways instead (boards.css). */
const MIN_COLUMN = 280;

interface BoardMeasure {
  columns: number[];
  frame: number;
  /** Lines the card's title takes, and whether it is cut short. */
  titleLines: number;
  titleCut: boolean;
}

function measure(card: Locator): Promise<BoardMeasure> {
  return card.evaluate((el, frameSel) => {
    const frame = el.closest(frameSel) as HTMLElement;
    const title = el.querySelector(".rg-board__card-title") as HTMLElement;
    const line = Number.parseFloat(getComputedStyle(title).lineHeight);
    return {
      columns: Array.from(frame.querySelectorAll(".rg-board__column")).map(
        (c) => c.getBoundingClientRect().width,
      ),
      frame: frame.getBoundingClientRect().width,
      titleLines: Math.round(title.getBoundingClientRect().height / line),
      titleCut: title.scrollHeight > title.clientHeight + 1,
    };
  }, "[role=dialog]");
}

export async function checkBoardLayout(page: Page, panel: Locator, card: Locator): Promise<void> {
  const original = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of [{ width: 1280, height: 720 }, original]) {
    await page.setViewportSize(size);
    const layout = await settledDialogLayout(page, panel);
    const at = `${size.width}×${size.height}`;
    expect(insideViewport(layout), `Issue board at ${at}: X inside the viewport`).toBe(true);
    expect(layout.closeHittable, `Issue board at ${at}: X clickable`).toBe(true);
    expect(layout.horizontalOverflow, `Issue board at ${at}`).toEqual([]);
    expect(layout.frameScrolls).toBe(false);
    const m = await measure(card);
    // Three columns of an issue board: the window is far wider than the old 660px.
    expect(m.frame).toBeGreaterThan(900);
    expect(m.frame).toBeLessThanOrEqual(size.width);
    expect(m.columns.length).toBeGreaterThanOrEqual(3);
    for (const w of m.columns) expect(w).toBeGreaterThanOrEqual(MIN_COLUMN);
    expect(m.titleLines).toBeLessThanOrEqual(3);
    expect(m.titleCut).toBe(false);
  }
}
