/**
 * Settings → Agents in the office e2e (#58): connecting a person's own Hermes. The owner picks
 * "Connect my existing Hermes agent", sees the two fields and what to set up in Hermes, tests
 * an address where nothing answers and is told so in plain words, creates the agent, and finds
 * on its card that the connection is stored and not shown. No Hermes runs here: turns, streams
 * and reconnecting are checked against the fake gateway in apps/server/src/pm/hermes/*.test.ts.
 */
import { expect, type Page, test } from "@playwright/test";

const TOKEN = "e2e-hermes-key-0123456789abcdef";
/** Nothing listens on port 1. */
const NOWHERE = "http://127.0.0.1:1";

export async function checkHermesConnection(page: Page, screenshotDir?: string) {
  const name = `Hermes ${test.info().repeatEachIndex + 1}`;
  await page.bringToFront();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Agents", exact: true }).click();
  const section = dialog.getByRole("region", { name: "Office agents" });
  await section.getByRole("button", { name: "New agent…" }).click();
  const form = section.getByRole("form", { name: "New agent" });

  await form.getByLabel("Runs as").selectOption({ label: "Connect my existing Hermes agent" });
  await expect(form).toContainText("Telegram and its other channels keep working");
  // Hermes brings its own provider and model: nothing to pick.
  await expect(form.getByLabel("Runs on")).toHaveCount(0);
  // What to set up on the Hermes side, with this office's own address in it.
  await form.getByText("What to set up in Hermes").click();
  await expect(form).toContainText("API_SERVER_ENABLED=true");
  await expect(form).toContainText(`url: "${new URL(page.url()).origin}/mcp"`);
  // A shared agent cannot be someone's own Hermes.
  await form.getByLabel("Belongs to").selectOption("office");
  await expect(form.getByLabel("Runs as").locator("option")).toHaveCount(1);
  await form.getByLabel("Belongs to").selectOption("me");
  await form.getByLabel("Runs as").selectOption({ label: "Connect my existing Hermes agent" });

  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByRole("button", { name: "Create agent" }).click();
  await expect(form).toContainText("Enter the address of your Hermes.");
  await form.getByLabel("Address of your Hermes").fill(NOWHERE);
  await form.getByLabel("Access token").fill(TOKEN);
  await form.getByRole("button", { name: "Test connection" }).click();
  await expect(form).toContainText("Nothing answers at that address");
  if (screenshotDir) await form.screenshot({ path: `${screenshotDir}/hermes-form.png` });
  await form.getByRole("button", { name: "Create agent" }).click();

  const card = section.getByRole("article", { name });
  await expect(card).toContainText("Runs as: My own Hermes");
  await expect(card).toContainText("Provider and model: its own");
  await expect(card).toContainText("kept encrypted and are not shown again");
  // The office sends back that a connection is stored, and nothing of it.
  const listed = await (await page.request.get("/api/office-agents")).text();
  expect(listed).toContain('"hermes":{"connected":true');
  expect(listed).not.toContain(TOKEN);
  expect(listed).not.toContain("127.0.0.1:1");

  await card.getByRole("button", { name: "Test connection" }).click();
  await expect(card).toContainText("Nothing answers at that address");
  // Talking to it says why it cannot, instead of waiting forever.
  await card.getByRole("button", { name: "Chat", exact: true }).click();
  await card.getByRole("textbox").last().fill("Are you there?");
  await card.getByRole("textbox").last().press("Enter");
  await expect(card).toContainText(/cannot be reached/);
  if (screenshotDir) await card.screenshot({ path: `${screenshotDir}/hermes-card.png` });

  await card.getByRole("button", { name: "Delete…" }).click();
  await card.getByRole("button", { name: `Delete ${name} for good` }).click();
  await expect(card).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
}
