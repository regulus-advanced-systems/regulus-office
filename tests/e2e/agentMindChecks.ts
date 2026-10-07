/**
 * Settings → Agents in the office e2e (#136): who an agent is, what it remembers and its
 * notes, on its card. The owner writes and saves who the agent is, looks at the history,
 * brings the first version back, adds and finds a memory and a note, and is told why a
 * key is not saved. Then privacy: the member's own personal agent is on the office owner's
 * list as a card only; the owner's browser gets 403 for its text and offers "Remove…".
 * No message is sent (this office has no runner): the agent's own side, through MCP and the
 * CLI engine, is checked in apps/server/src/pm (tools/memory.test.ts, engines/cli-mind.test.ts).
 */
import { expect, type Page, test } from "@playwright/test";

const FIRST = "You are my note taker.\nKeep answers short.";

async function openAgents(page: Page) {
  await page.bringToFront();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Agents", exact: true }).click();
  return { dialog, section: dialog.getByRole("region", { name: "Office agents" }) };
}

export async function checkAgentMind(ownerPage: Page, memberPage: Page, screenshotDir?: string) {
  const n = test.info().repeatEachIndex + 1;
  const name = `Scribe ${n}`;
  const theirs = `Diary ${n}`;

  // The member's own personal agent, with something private in it.
  const made = await memberPage.request.post("/api/office-agents", {
    data: {
      name: theirs,
      owner: "me",
      engine: "cli-session",
      role: "assistant",
      provider: "claude-code",
      model: "sonnet",
      instructions: "PRIVATE-136 only for its owner",
    },
  });
  expect(made.status()).toBe(201);
  const diary = (await made.json()) as { id: string };
  const diaryPath = `/api/office-agents/${diary.id}`;
  expect(
    (
      await memberPage.request.post(`${diaryPath}/memories`, {
        data: { kind: "memory", text: "PRIVATE-136 memory" },
      })
    ).status(),
  ).toBe(201);

  const { dialog, section } = await openAgents(ownerPage);
  await section.getByRole("button", { name: "New agent…" }).click();
  const form = section.getByRole("form", { name: "New agent" });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Who it is and how it works").fill(FIRST);
  await expect(form).toContainText("The agent reads this every time it starts.");
  await form.getByRole("button", { name: "Create agent" }).click();

  const card = section.getByRole("article", { name });
  await expect(card.getByTestId("agent-mind-privacy")).toHaveText(
    "Private: only you can read and change this. Office owners and admins cannot.",
  );
  // Who it is: write, preview, save.
  await card.getByText("Who it is and how it works", { exact: true }).click();
  const soul = card.getByLabel(`Who it is and how it works of ${name}`);
  await expect(soul).toHaveValue(FIRST);
  await soul.fill(`${FIRST}\nWrite the **journal** every evening.`);
  await card.getByRole("tab", { name: "Preview" }).click();
  await expect(card.locator(".rg-md strong")).toHaveText("journal");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card).toContainText("version 2");
  // History: what changed, and the first version brought back as a third.
  await card.getByRole("tab", { name: "History" }).click();
  await expect(card.locator(".rg-agent-mind__row")).toHaveCount(2);
  await card.locator(".rg-agent-mind__row").first().getByRole("button", { name: "Show" }).click();
  await expect(card.locator(".rg-agent-soul__line.is-add")).toHaveText(
    /\+ Write the \*\*journal\*\* every evening\./,
  );
  if (screenshotDir) await card.screenshot({ path: `${screenshotDir}/who-it-is-history.png` });
  await card.locator(".rg-agent-mind__row").nth(1).getByRole("button", { name: "Show" }).click();
  await card.getByRole("button", { name: "Bring version 1 back" }).click();
  await expect(soul).toHaveValue(FIRST);
  await expect(card).toContainText("version 3");

  // What it remembers: add, find, be refused a key.
  await card.getByText("What it remembers", { exact: true }).click();
  const memories = card.locator("details", { hasText: "What it remembers" });
  await memories.getByRole("button", { name: "Add a memory" }).click();
  await memories.getByLabel("What to remember").fill("Standup is at 9:30");
  await memories.getByRole("button", { name: "Save", exact: true }).click();
  await expect(memories).toContainText("Standup is at 9:30");
  await memories.getByRole("button", { name: "Add a memory" }).click();
  await memories.getByLabel("What to remember").fill("the key is sk-ant-api03-FAKEFAKEFAKEFAKE");
  await memories.getByRole("button", { name: "Save", exact: true }).click();
  await expect(memories.getByRole("alert")).toContainText("Secrets are never stored here");
  await memories.getByRole("button", { name: "Cancel" }).click();
  await expect(memories.getByRole("alert")).toHaveCount(0);
  await memories.getByPlaceholder("Search what it remembers").fill("nothing like this");
  await expect(memories).toContainText("Nothing found.");
  await memories.getByPlaceholder("Search what it remembers").fill("standup");
  await expect(memories).toContainText("Standup is at 9:30");
  // Notes.
  await card.getByText("Notes", { exact: true }).click();
  const notes = card.locator("details", { hasText: "Longer pages the agent keeps" });
  await notes.getByRole("button", { name: "Add a note" }).click();
  await notes.getByLabel("Title").fill("Journal");
  await notes.getByLabel("Text").fill("Monday: planned the week.");
  await notes.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notes).toContainText("Monday: planned the week.");
  if (screenshotDir) {
    // The card with what it remembers and its notes open; who it is is in the other picture.
    await card.getByText("Who it is and how it works", { exact: true }).click();
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${screenshotDir}/agent-card.png` });
  }
  await memories.getByRole("button", { name: "Delete…" }).click();
  await memories.getByRole("button", { name: "Delete this memory for good" }).click();
  await expect(memories).toContainText("Nothing found.");

  // The member's agent, to the office owner: a card, none of its text, and "Remove…".
  const other = section.getByRole("article", { name: theirs });
  await expect(other).toContainText(
    "only the person it belongs to can talk to it or read who it is",
  );
  await expect(other.locator("details")).toHaveCount(0);
  await expect(section).not.toContainText("PRIVATE-136");
  for (const path of ["/soul", "/soul/versions", "/soul/versions/1", "/memories?kind=memory"]) {
    const res = await ownerPage.request.get(`${diaryPath}${path}`);
    expect([path, res.status()]).toEqual([path, 403]);
    expect(await res.text()).not.toContain("PRIVATE-136");
  }
  expect(await (await ownerPage.request.get("/api/office-agents")).text()).not.toContain(
    "PRIVATE-136",
  );
  // The member reads their own; the owner's agent does not exist for the member.
  expect(await (await memberPage.request.get(`${diaryPath}/soul`)).json()).toMatchObject({
    version: 1,
    content: "PRIVATE-136 only for its owner",
  });
  const mine = (await (await ownerPage.request.get("/api/office-agents")).json()).agents.find(
    (a: { name: string }) => a.name === name,
  );
  expect((await memberPage.request.get(`/api/office-agents/${mine.id}/soul`)).status()).toBe(404);

  // The owner removes the member's agent without having read it; then their own.
  await other.getByRole("button", { name: "Remove…" }).click();
  await other
    .getByRole("button", { name: `Remove ${theirs} and everything it holds, for good` })
    .click();
  await expect(other).toHaveCount(0);
  expect((await memberPage.request.get(`${diaryPath}/soul`)).status()).toBe(404);
  await card.getByRole("button", { name: "Delete…" }).first().click();
  await card.getByRole("button", { name: `Delete ${name} for good` }).click();
  await expect(card).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
}
