/**
 * Sizes of the "Connect providers" panel around a login terminal (#156): the
 * terminal box at normal size and expanded, and the panel width that holds it.
 */
import { expandedTerminalSize, MODAL_CHROME_PX, type Size } from "../terminal/expand.ts";

export const PANEL_WIDTH = 760;
/** A provider row's padding and border on both sides. */
const ROW_CHROME_PX = 2 * 10 + 2 * 1;
/** The panel's own height around the terminal box (title, row, link bar, help, footer). */
const RESERVE_HEIGHT = 300;

export const LOGIN_TERMINAL_NORMAL: Size = {
  width: PANEL_WIDTH - MODAL_CHROME_PX - ROW_CHROME_PX,
  height: 320,
};

export function loginTerminalSize(viewport: Size, expanded: boolean): Size {
  return expanded
    ? expandedTerminalSize(viewport, LOGIN_TERMINAL_NORMAL, RESERVE_HEIGHT)
    : LOGIN_TERMINAL_NORMAL;
}

export function providersPanelWidth(viewport: Size, expanded: boolean): number {
  if (!expanded) return PANEL_WIDTH;
  return loginTerminalSize(viewport, true).width + MODAL_CHROME_PX + ROW_CHROME_PX;
}
