/**
 * Lost access in the office e2e (#244, #270): the member's GitHub account gets read access to
 * the room's repo, the member walks in, and the access is taken away on GitHub while the member
 * stands there (the office hears of it on the next check, here "Check now"). The
 * member's room closes at once: a plain message says so, it stays (no flicker of retries), and
 * the browser does not knock on the room's door again.
 */
import { expect, type Page } from "@playwright/test";
import { roomNamed, walkInto, walkToLobby } from "./compoundProbes.ts";
import { MEMBER_GITHUB } from "./fakeGitHub.ts";
import { checkGitHubNow, officeGitHubUrl, setRepoPermission } from "./githubAccess.ts";
import { waitForScene } from "./probes.ts";

const MESSAGE = "You no longer have access to this room.";

export async function checkAccessWithdrawn(
  owner: Page,
  member: Page,
  operation: string,
  repo: string,
) {
  const room = await roomNamed(owner, operation);
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "read");
  await checkGitHubNow(member);
  // The member's operation list (and with it room access) refreshes on reload.
  await member.reload();
  await waitForScene(member);
  await walkInto(member, operation);
  await expect(member.locator(".rg-topbar__operation")).toHaveText(operation);
  await expect(member.getByText(MESSAGE)).toHaveCount(0);

  // From here on, every time the member's browser asks for a room seat is counted.
  const joins: string[] = [];
  const onRequest = (request: { url(): string }) => {
    if (request.url().includes("/matchmake/")) joins.push(request.url());
  };
  member.on("request", onRequest);
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "none");
  await checkGitHubNow(member);

  // Told once, promptly, in plain words; the message stays until dismissed.
  await expect(member.getByText(MESSAGE)).toBeVisible({ timeout: 5_000 });
  await member.waitForTimeout(3_000);
  await expect(member.getByText(MESSAGE)).toHaveCount(1);
  member.off("request", onRequest);
  expect(joins, "the browser asked for the closed room again").toEqual([]);
  // The office itself is still there for them.
  const me = await member.request.get("/api/me");
  expect(me.status()).toBe(200);
  const list = (await (await member.request.get("/api/operations")).json()) as {
    operations?: { operationId: string }[];
  };
  expect((list.operations ?? []).some((o) => o.operationId === room.id)).toBe(false);

  await walkToLobby(member);
}
