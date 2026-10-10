/**
 * One task across two rooms in the office e2e (#257). The owner, whose GitHub account writes
 * to both repos, queues one task in the first room and ticks the second: each room gets a part,
 * and the queue shows them as one task with one combined state. The member's GitHub account
 * reads the first repo only: for them the part in that room is an ordinary task, and neither
 * the page nor the API says a word about the other room. (No agent CLI runs in this flow, so
 * the parts fail to start; that failure is shown on the task, part by part.)
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { clickInScene, roomNamed, travelInto, walkToLobby } from "./compoundProbes.ts";
import { MEMBER_GITHUB } from "./fakeGitHub.ts";
import { checkGitHubNow, officeGitHubUrl, setRepoPermission } from "./githubAccess.ts";
import { waitForScene } from "./probes.ts";

const CLIPBOARD = "queue-hotspot-queue-clipboard";
const TITLE = "Orders in both repos";

interface Listed {
  tasks: { id: string; parts: { roomName: string; repo: string; state: string }[] }[];
}

const linkedIn = async (page: Page, operationId: string): Promise<Listed> => {
  const res = await page.request.get(`/api/linked-tasks?operationId=${operationId}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Listed;
};

const NOTE = "[api] POST /orders returns { id, status }";

/**
 * The owner's notes in the panel. No henchman runs in this flow, so the office has no note to
 * show: one is put into this browser's own answers (the list, and the release call), which
 * checks the panel only. The server side of notes is in notes.test.ts and the route audit.
 */
async function notesInAnswers(owner: Page) {
  let released = 0;
  const list = "**/api/linked-tasks?operationId=*";
  const release = "**/api/linked-tasks/*/notes/e2e-note/release";
  await owner.route(list, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      tasks: { parts: { taskId: string }[]; notes?: unknown[] }[];
    };
    const task = body.tasks[0];
    if (task) {
      const from = task.parts[1]?.taskId ?? "";
      task.notes = [
        { id: "e2e-note", taskId: from, body: NOTE, createdAt: 1, releasedAt: released },
      ];
    }
    await route.fulfill({ response, json: body });
  });
  await owner.route(release, async (route) => {
    released = Date.now();
    await route.fulfill({ json: { id: "e2e" } });
  });
  return async () => {
    await owner.unroute(list);
    await owner.unroute(release);
  };
}

async function checkNotePassedOn(block: Locator, screenshotDir?: string) {
  const note = block.locator('[data-note="e2e-note"]');
  await expect(note).toContainText(NOTE);
  await expect(block).toContainText("people who cannot see the room it came from");
  if (screenshotDir) await block.screenshot({ path: `${screenshotDir}/queue-panel-note.png` });
  await note.getByRole("button", { name: "Pass on to the other parts" }).click();
  await expect(note).toContainText("passed on");
  await expect(note.getByRole("button")).toHaveCount(0);
}

export async function checkLinkedTask(
  owner: Page,
  member: Page,
  rooms: { first: string; firstRepo: string; second: string; secondRepo: string },
  screenshotDir?: string,
) {
  const first = await roomNamed(owner, rooms.first);
  const second = await roomNamed(owner, rooms.second);

  // The member reads the first repo only. Their page reloads (the room list is read at load)
  // while the owner works: a scene takes a while to draw in software WebGL.
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, rooms.firstRepo, "read");
  await checkGitHubNow(member);
  const reloaded = member.reload();

  // The owner queues one task over both rooms from the first room's clipboard.
  const stopNotes = await notesInAnswers(owner);
  await travelInto(owner, rooms.first);
  const panel = owner.getByRole("dialog", { name: "Task queue" });
  await clickInScene(owner, CLIPBOARD, panel);
  await panel.getByRole("button", { name: "Queue a task…" }).click();
  const dialog = owner.getByRole("dialog", { name: "Queue a task" });
  const also = dialog.getByRole("group", { name: "Also in these rooms" });
  await also.getByLabel(new RegExp(`^\\s*${rooms.second}\\b`)).check();
  // Naming private repos in each other's pull requests is offered, and off unless ticked.
  await expect(also.getByLabel(/Also name private repos/)).not.toBeChecked();
  await dialog.getByLabel("Task title").fill(TITLE);
  await dialog.getByLabel(/^Prompt/).fill("Add an orders endpoint and the page that calls it.");
  if (screenshotDir) await dialog.screenshot({ path: `${screenshotDir}/queue-dialog-also-in.png` });
  await dialog.getByRole("button", { name: "Queue task" }).click();
  await expect(dialog).toHaveCount(0);

  // One task, two parts, as the owner sees it: in the panel and from the API, from either room.
  const row = panel.locator(".rg-queue__task", { hasText: TITLE });
  await expect(row.locator("[data-linked]")).toContainText("Across 2 rooms", { timeout: 20_000 });
  await expect(row.locator("[data-linked]")).toContainText(rooms.second);
  await expect(row.locator("[data-linked]")).toContainText(rooms.secondRepo);
  // The owner's notes section, with the warning about who reads a note that is passed on.
  await expect(row.locator("[data-linked]")).toContainText("Notes for you");
  await expect(row.locator("[data-linked]")).toContainText("Pass new notes on without asking me");
  if (screenshotDir) await panel.screenshot({ path: `${screenshotDir}/queue-panel-owner.png` });
  for (const room of [first, second]) {
    const listed = await linkedIn(owner, room.id);
    expect(listed.tasks).toHaveLength(1);
    expect(listed.tasks[0]?.parts.map((p) => p.repo)).toEqual([rooms.firstRepo, rooms.secondRepo]);
  }
  await checkNotePassedOn(row.locator("[data-linked]"), screenshotDir);
  await stopNotes();
  if (screenshotDir)
    await panel.screenshot({ path: `${screenshotDir}/queue-panel-note-passed.png` });
  await owner.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  await reloaded;
  await waitForScene(member);
  for (const id of [first.id, second.id, "no-such-room"]) {
    expect(await linkedIn(member, id)).toEqual({ tasks: [] });
  }
  await travelInto(member, rooms.first);
  const theirs = member.getByRole("dialog", { name: "Task queue" });
  await clickInScene(member, CLIPBOARD, theirs);
  // The part in their room is there, as an ordinary task.
  await expect(theirs.locator(".rg-queue__task", { hasText: TITLE })).toBeVisible();
  await expect(theirs.locator("[data-linked]")).toHaveCount(0);
  const seen = await member.evaluate(() => document.body.innerText);
  for (const hidden of [
    rooms.second,
    rooms.secondRepo,
    "Across",
    "Stop the whole task",
    "Notes for you",
  ]) {
    expect(seen, `the member's page says "${hidden}"`).not.toContain(hidden);
  }
  if (screenshotDir) await theirs.screenshot({ path: `${screenshotDir}/queue-panel-member.png` });
  await member.keyboard.press("Escape");
  await expect(theirs).toHaveCount(0);

  // Both go back to the lobby for the next step. The member leaves first and loses the repo
  // afterwards: taken away while they stand in the room, the level closes under them while
  // they are travelling (that case has its own step, accessChecks.ts).
  await walkToLobby(member);
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, rooms.firstRepo, "none");
  await checkGitHubNow(member);
  await walkToLobby(owner);
}
