/**
 * Dialog layout probe (#149): measures the open Modal in the real browser.
 * The round X must lie wholly inside the viewport and be the element hit at
 * its centre (not clipped or covered), and neither the frame, its body, nor
 * the page may scroll sideways.
 */
import type { Locator, Page } from "@playwright/test";

export interface DialogLayout {
  viewport: { width: number; height: number };
  close: { x: number; y: number; width: number; height: number } | null;
  /** The element at the X's centre is the X (or inside it). */
  closeHittable: boolean;
  /** Frame, body or page wider than their box (a horizontal scrollbar). */
  horizontalOverflow: string[];
  /** The frame itself scrolls (only the body may). */
  frameScrolls: boolean;
}

export async function dialogLayout(dialog: Locator): Promise<DialogLayout> {
  return dialog.evaluate((frame) => {
    const root = document.documentElement;
    const close = frame.querySelector<HTMLElement>(":scope > .rg-modal__close");
    const box = close?.getBoundingClientRect() ?? null;
    let closeHittable = false;
    if (close && box) {
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      closeHittable = hit !== null && (hit === close || close.contains(hit));
    }
    const horizontalOverflow: string[] = [];
    const wide = (el: Element | null, name: string) => {
      if (el && el.scrollWidth > el.clientWidth + 1)
        horizontalOverflow.push(`${name} ${el.scrollWidth}>${el.clientWidth}`);
    };
    wide(frame, "frame");
    wide(frame.querySelector(":scope > .rg-modal__body"), "body");
    wide(root, "page");
    const style = getComputedStyle(frame);
    return {
      viewport: { width: root.clientWidth, height: root.clientHeight },
      close: box && { x: box.x, y: box.y, width: box.width, height: box.height },
      closeHittable,
      horizontalOverflow,
      frameScrolls: style.overflowY !== "visible" && frame.scrollHeight > frame.clientHeight + 1,
    };
  });
}

/** True when `box` lies wholly inside the viewport. */
export function insideViewport(layout: DialogLayout): boolean {
  const { close, viewport } = layout;
  if (!close) return false;
  return (
    close.x >= 0 &&
    close.y >= 0 &&
    close.x + close.width <= viewport.width &&
    close.y + close.height <= viewport.height
  );
}

/** Waits for the dialog's open animation to settle before measuring. */
export async function settledDialogLayout(page: Page, dialog: Locator): Promise<DialogLayout> {
  await dialog.waitFor();
  await page.waitForFunction(
    (el) => (el as HTMLElement).getAnimations().every((a) => a.playState !== "running"),
    await dialog.elementHandle(),
  );
  return dialogLayout(dialog);
}
