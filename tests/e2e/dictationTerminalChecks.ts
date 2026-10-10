/**
 * Dictation into a henchman's real terminal, in the agents e2e (#260): xterm.js in the page,
 * the terminal socket, tmux in the runner. The speech recogniser is scripted
 * (dictationProbes.ts); the rest is what a person gets.
 *
 * - Watching: Ctrl+Space says the terminal is only watched, records nothing, types nothing.
 * - In control: holding it shows the indicator; what is said arrives in the henchman's tmux
 *   pane as typed text, the cursor stays on that line (no Enter), and the key itself never
 *   reaches the program (Ctrl+Space would be a NUL, echoed as `^@`).
 */
import { expect, type Page } from "@playwright/test";
import { holdKey, installFakeSpeech, releaseKey, say, speech } from "./dictationProbes.ts";

export async function checkTerminalDictation(
  page: Page,
  open: () => Promise<void>,
  /** Run tmux in the henchman's sandbox against its pane (`-t` is added). */
  tmux: (args: string[]) => string,
): Promise<void> {
  await page.bringToFront();
  await installFakeSpeech(page, "available");
  await open();
  const terminal = page.getByRole("dialog").filter({ hasText: /In control|Watching/ });
  await expect(terminal.getByTestId("terminal-mode")).toHaveText("Watching");
  await expect(terminal.getByTestId("terminal-screen")).toHaveAttribute("data-status", "open");
  const pill = page.getByTestId("dictation-pill");
  const notice = page.getByTestId("dictation-notice");
  const screen = () => tmux(["capture-pane", "-p"]);
  const before = screen();

  // Watching: the terminal has the keyboard, but nothing may be typed or dictated into it.
  await terminal.locator(".xterm-helper-textarea").focus();
  await expect(page.getByTestId("dictation-mic")).toBeHidden();
  await holdKey(page);
  await expect(notice).toHaveAttribute("data-kind", "watch-only");
  await releaseKey(page);
  await expect(pill).toBeHidden();
  expect((await speech(page)).made).toBe(0);
  expect(screen()).toBe(before);

  // In control: the mic button stands in the terminal's corner; hold, speak, let go.
  await terminal.getByRole("button", { name: "Take control" }).click();
  await expect(terminal.getByTestId("terminal-mode")).toHaveText("In control");
  await terminal.locator(".xterm-helper-textarea").focus();
  await expect(page.getByTestId("dictation-mic")).toBeVisible();
  await holdKey(page);
  // This browser's first dictation says where the audio goes first; read it and hold again.
  const intro = page.locator('[data-testid="dictation-notice"][data-kind="intro"]');
  await expect(intro.or(page.getByTestId("dictation-indicator"))).toBeVisible();
  if (await intro.isVisible()) {
    await releaseKey(page);
    expect((await speech(page)).made).toBe(0);
    await page.getByTestId("dictation-intro-ok").click();
    await holdKey(page);
  }
  await expect(pill).toHaveAttribute("data-phase", "listening");
  if (process.env.E2E_SHOTS_DIR)
    await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/07-terminal-listening.png` });
  await say(page, "dictated into the terminal\n");
  await say(page, "twice");
  await releaseKey(page);
  await expect(page.getByTestId("dictation-indicator")).toBeHidden();
  expect((await speech(page)).live).toBe(false);

  const phrase = "dictated into the terminal twice";
  await expect.poll(screen, { timeout: 15_000 }).toContain(phrase);
  // No Enter: the cursor still stands right after the words, on their line.
  const line = screen()
    .split("\n")
    .find((l) => l.includes(phrase));
  expect(line?.trimEnd().endsWith(phrase)).toBe(true);
  const cursor = Number(tmux(["display-message", "-p", "#{cursor_x}"]).trim());
  expect(cursor).toBe((line ?? "").indexOf(phrase) + phrase.length);
  // The key was dictation's alone: no NUL reached the program.
  expect(screen()).not.toContain("^@");
  if (process.env.E2E_SHOTS_DIR)
    await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/08-terminal-typed-no-enter.png` });

  // Leave the henchman's line as it was (Ctrl+U drops the unsent text).
  await page.keyboard.press("Control+u");
  await terminal.getByRole("button", { name: "Release control" }).click();
  await expect(terminal.getByTestId("terminal-mode")).toHaveText("Watching");
  await terminal.getByRole("button", { name: /Close/ }).first().click();
  await expect(terminal).toHaveCount(0);
}
