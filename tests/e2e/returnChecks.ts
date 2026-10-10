/**
 * Coming back where you left, in the office e2e (#262; SPEC D26, D27): the owner walks into a
 * room on its repo owner's level and reloads the page: they are back on that level, in that
 * room, where they stood, with the room's HUD. The member is given the room, walks in, closes
 * the tab and loses the room on GitHub while away: when they open the office again they are in
 * the lobby, on the lobby level, and nothing on their page says a room was closed to them or
 * names it.
 *
 * Reads where the player is through `window.__regulusNav` (compoundProbes.ts).
 */
import { expect, type Page } from "@playwright/test";
import {
  navLevel,
  navLevels,
  navPose,
  navRooms,
  waitStill,
  walkInto,
  walkToLobby,
} from "./compoundProbes.ts";
import { MEMBER_GITHUB } from "./fakeGitHub.ts";
import { checkGitHubNow, officeGitHubUrl, setRepoPermission } from "./githubAccess.ts";
import { OFFICE_PROBE_PATH, waitForScene } from "./probes.ts";

/** The building hears a pose at most every 50 ms; this long after standing still it has the last one. */
const POSE_SENT_MS = 600;

export async function checkReturnWhereYouLeft(
  owner: Page,
  member: Page,
  operation: string,
  repo: string,
): Promise<void> {
  // The owner, in the room: a reload brings them back to it.
  const room = await walkInto(owner, operation);
  const left = await waitStill(owner);
  const level = await navLevel(owner);
  expect(level).not.toBe("lobby");
  await owner.waitForTimeout(POSE_SENT_MS);
  await owner.reload();
  await waitForScene(owner);
  expect(await navLevel(owner)).toBe(level);
  const back = await navPose(owner);
  expect(back.room).toBe(room.id);
  expect(Math.hypot(back.x - left.x, back.z - left.z)).toBeLessThan(1);
  // Not only standing there: in the room, with its HUD.
  await expect.poll(async () => (await navPose(owner)).operationId).toBe(room.id);
  await expect(owner.locator(".rg-topbar__operation")).toHaveText(operation);

  // The member is given the room and walks in.
  const origin = new URL(member.url()).origin;
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "read");
  await checkGitHubNow(member);
  // The member's operation list (and with it room access) refreshes on reload.
  await member.reload();
  await waitForScene(member);
  await walkInto(member, operation);
  await waitStill(member);
  await member.waitForTimeout(POSE_SENT_MS);

  // They close the tab; while they are away GitHub takes the room from them.
  await member.goto("about:blank");
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "none");
  await expect
    .poll(
      async () =>
        (
          await member.request.post(`${origin}/api/github/link/check`, { headers: { origin } })
        ).status(),
      { timeout: 20_000, intervals: [500, 1000, 2000] },
    )
    .toBe(200);

  // Back in the office: the lobby, as for anyone who arrives, and not a word about the room.
  await member.goto(`${origin}${OFFICE_PROBE_PATH}`);
  await waitForScene(member);
  expect(await navLevel(member)).toBe("lobby");
  const lobby = (await navRooms(member)).find((r) => r.kind === "lobby");
  expect((await navPose(member)).room).toBe(lobby?.id ?? "no lobby");
  expect((await navLevels(member)).map((l) => l.levelId)).toEqual(["lobby"]);
  await member.waitForTimeout(2_000);
  await expect(member.locator(".rg-toast")).toHaveCount(0);
  expect(await member.evaluate(() => document.body.innerText)).not.toContain(operation);
  expect(await navLevel(member)).toBe("lobby");
  await expect(member.locator(".rg-topbar__operation")).toHaveText("Lobby");

  await walkToLobby(owner);
}
