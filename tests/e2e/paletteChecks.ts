/**
 * The command palette in a real browser (#261): Ctrl+K opens it from the scene and not from
 * a text field or under an open dialog; it is worked by keyboard alone (type, Enter); what
 * it offers follows who is asking (build mode is the owner's, not the member's); and a
 * picked room is travelled to.
 *
 * With `E2E_SHOTS_DIR` set it also saves the screenshots for the PR.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { navPose } from "./compoundProbes.ts";
import { distance } from "./probes.ts";
import { backToLobbyMiddle } from "./socialChecks.ts";

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
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
  await box(member).fill("war room");
  await expect(rows(member).first()).toContainText("Go to War room");
  await member.keyboard.press("Enter");
  await expect(palette(member)).toHaveCount(0);
  await expect
    .poll(async () => distance(await navPose(member), before), { timeout: 15_000 })
    .toBeGreaterThan(2);
  await backToLobbyMiddle(member);
}
