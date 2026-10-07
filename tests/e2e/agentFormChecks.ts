/**
 * Settings → Agents in the office e2e (#280): the form in plain words. The owner creates a
 * personal agent with what it runs as, what it runs on, a model from the list and an
 * appearance from the gallery; the card then says all of it, and changing the appearance
 * keeps the agent. No message is sent: this office has no runner, and the turn itself (model
 * and key really used, DeepSeek included) is checked with the fake CLI in
 * apps/server/src/pm/runs-on.test.ts.
 */
import { expect, type Page, test } from "@playwright/test";

export async function checkAgentForm(page: Page, screenshotDir?: string) {
  const name = `Scout ${test.info().repeatEachIndex + 1}`;
  await page.bringToFront();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Agents", exact: true }).click();
  const section = dialog.getByRole("region", { name: "Office agents" });
  await section.getByRole("button", { name: "New agent…" }).click();
  const form = section.getByRole("form", { name: "New agent" });

  // Runs as: one option today, in view, with what it means.
  await expect(form.getByLabel("Runs as").locator("option")).toHaveText([
    "Claude Code session (runs here in the office)",
  ]);
  await expect(form).toContainText("The program that runs this agent.");
  // Runs on: the owner's own login is there (this office cannot check it, so it is not ruled out).
  await expect(form.getByLabel("Runs on").locator("option")).toHaveText([
    /^Claude, on my subscription login/,
  ]);
  await expect(form.getByRole("radio", { name: /^Sonnet/ })).toBeChecked();
  await expect(form.getByRole("radio", { name: /^Opus\s*Strong/ })).toBeVisible();
  await form.getByRole("radio", { name: /^Haiku\s*Cheap/ }).check();
  // The gallery: the skins' thumbnails, and a plain plate for a form with no thumbnail yet.
  const gallery = form.getByRole("group", { name: "Appearance" });
  await expect(gallery.getByRole("radio")).not.toHaveCount(0);
  await expect(gallery.locator('img[src^="data:image/png"]').first()).toBeVisible();
  await gallery.getByRole("radio", { name: "Chef", exact: true }).check();
  await form.getByLabel("Name", { exact: true }).fill(name);
  if (screenshotDir) await form.screenshot({ path: `${screenshotDir}/create-form.png` });
  await form.getByRole("button", { name: "Create agent" }).click();

  const card = section.getByRole("article", { name });
  await expect(card).toContainText("Runs as: Claude Code session");
  await expect(card).toContainText("Runs on: Claude subscription");
  await expect(card).toContainText("Model: Haiku");
  await expect(card).toContainText("Looks: Chef");
  const stored = async () => {
    const body = await (await page.request.get("/api/office-agents")).json();
    return body.agents.find((a: { name: string }) => a.name === name);
  };
  const created = await stored();
  expect(created).toMatchObject({
    engine: "cli-session",
    model: "haiku",
    appearance: "chef",
    runsOn: { kind: "login", officeKey: false },
  });

  // Changing it offers the same fields; a new appearance keeps the agent it is.
  await card.getByRole("button", { name: "Change…" }).click();
  const edit = card.getByRole("form", { name: `Change ${name}` });
  await expect(edit.getByLabel("Name", { exact: true })).toBeDisabled();
  await expect(edit.getByRole("radio", { name: /^Haiku/ })).toBeChecked();
  await edit.getByRole("radio", { name: "Lab coat", exact: true }).check();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(card).toContainText("Looks: Lab coat");
  if (screenshotDir) await card.screenshot({ path: `${screenshotDir}/agent-card.png` });
  expect(await stored()).toMatchObject({ id: created.id, appearance: "lab_coat", model: "haiku" });

  // Leave nothing behind, so the step can run again.
  await card.getByRole("button", { name: "Delete…" }).click();
  await card.getByRole("button", { name: `Delete ${name} for good` }).click();
  await expect(card).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
}
