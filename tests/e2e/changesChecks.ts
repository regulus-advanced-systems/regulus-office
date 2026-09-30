/**
 * The changes window (#38) in the agents e2e: the owner reviews the robot's branch, commits
 * one of two new files and discards the other after confirming; a member on the floor sees
 * the same window read-only and the server refuses their commit. Git runs in the robot's
 * docker sandbox, so this also proves the runner path end to end.
 */
import { expect, type Page } from "@playwright/test";

export interface ChangesCheckDeps {
  ownerPage: Page;
  memberPage: Page;
  agentId: string;
  task: string;
  /** Open the robot panel on `page`. */
  openPanel(page: Page): Promise<void>;
  /** Write a file into the robot's worktree as the runner user (inside its sandbox). */
  writeInWorktree(name: string, content: string): void;
  /** Plain git in the robot's worktree, from the host. */
  worktreeGit(args: string[]): string;
  worktreeHas(name: string): boolean;
}

export async function checkChangesWindow(d: ChangesCheckDeps): Promise<void> {
  const title = `Changes: ${d.task}`;

  // The owner: the robot's commit shows against the merge-base, with its diff.
  await d.openPanel(d.ownerPage);
  await d.ownerPage
    .locator("section.rg-agent-panel")
    .getByRole("button", { name: "Review changes" })
    .click();
  const win = d.ownerPage.getByRole("dialog", { name: title });
  await expect(win.locator('li[data-path="FAKE_CLAUDE.md"]')).toBeVisible();
  await expect(win).toContainText("1 commit · 0 uncommitted");
  await expect(win.getByTestId("changes-diff")).toBeVisible();

  // Two new files appear within a poll or two.
  d.writeInWorktree("notes.txt", "notes from the e2e\n");
  d.writeInWorktree("scratch.txt", "throw me away\n");
  await expect(win.locator('li[data-path="notes.txt"]')).toBeVisible();
  await expect(win.locator('li[data-path="scratch.txt"]')).toBeVisible();
  await expect(win).toContainText("2 uncommitted");

  // Commit only notes.txt.
  await win.getByLabel("Include scratch.txt in the commit").uncheck();
  await win.getByLabel("Commit message").fill("Add notes from the changes window");
  await win.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(win.getByRole("status")).toContainText("Committed 1 file");
  expect(d.worktreeGit(["log", "-1", "--format=%s"])).toBe("Add notes from the changes window");
  expect(d.worktreeGit(["show", "--name-only", "--format=", "HEAD"])).toBe("notes.txt");

  // Discard scratch.txt, after confirming.
  await win.getByRole("button", { name: "Discard changes to scratch.txt" }).click();
  const confirm = win.getByRole("alertdialog", { name: "Confirm discard" });
  await expect(confirm).toContainText("The file will be deleted");
  await confirm.getByRole("button", { name: "Discard" }).click();
  await expect(win.locator('li[data-path="scratch.txt"]')).toHaveCount(0);
  expect(d.worktreeHas("scratch.txt")).toBe(false);
  await expect(win).toContainText("2 commits · 0 uncommitted");
  await win.getByRole("button", { name: "Done", exact: true }).click();
  await expect(win).toHaveCount(0);

  // A member on the floor watches read-only; the server refuses their writes (D12).
  await d.openPanel(d.memberPage);
  await d.memberPage
    .locator("section.rg-agent-panel")
    .getByRole("button", { name: "View changes" })
    .click();
  const watch = d.memberPage.getByRole("dialog", { name: title });
  await expect(watch.locator('li[data-path="notes.txt"]')).toBeVisible();
  await expect(watch.getByTestId("changes-readonly")).toBeVisible();
  await expect(watch.getByRole("form", { name: "Commit" })).toHaveCount(0);
  const refused = await d.memberPage.request.post(`/api/agents/${d.agentId}/changes/commit`, {
    data: { message: "sneaky", files: [{ path: "notes.txt", sig: null }] },
    headers: { origin: new URL(d.memberPage.url()).origin },
  });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toBe("owner_only");
  await watch.getByRole("button", { name: "Done", exact: true }).click();
  await expect(watch).toHaveCount(0);
}
