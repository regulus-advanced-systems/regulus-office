/**
 * Coming back where you left, in the office e2e (#262; SPEC D26, D27): the owner, with a
 * personal agent, walks into a room on its repo owner's level and reloads the page: they are
 * back on that level, in that room, where they stood and facing the same way, with the room's
 * HUD and their agent beside them. The member is given the room, walks in, closes the tab and
 * loses the room on GitHub while away: when they open the office again they are at the lobby
 * spawn, on the lobby level, and nothing on their page says a room was closed to them or
 * names it.
 *
 * Reads where the player is through `window.__regulusNav` (compoundProbes.ts). With `shots`
 * set it also saves the screenshots for the PR.
 */
import { expect, type Page, test } from "@playwright/test";
import {
  navLevel,
  navLevels,
  navPose,
  navRooms,
  waitStill,
  walkInto,
  walkTo,
  walkToLobby,
} from "./compoundProbes.ts";
import { MEMBER_GITHUB } from "./fakeGitHub.ts";
import { checkGitHubNow, officeGitHubUrl, setRepoPermission } from "./githubAccess.ts";
import { bodyOf } from "./officeAgentProbes.ts";
import { angleBetween, OFFICE_PROBE_PATH, waitForScene } from "./probes.ts";

/** The building hears a pose at most every 50 ms; this long after standing still it has the last one. */
const POSE_SENT_MS = 600;

export async function checkReturnWhereYouLeft(
  owner: Page,
  member: Page,
  operation: string,
  repo: string,
  shots?: string,
): Promise<void> {
  const origin = new URL(owner.url()).origin;
  const headers = { origin };
  const made = await owner.request.post("/api/office-agents", {
    data: {
      engine: "cli-session",
      provider: "claude-code",
      model: "sonnet",
      name: `Returner ${test.info().repeatEachIndex + 1}`,
      owner: "me",
      role: "assistant",
      appearance: "secretary",
    },
    headers,
  });
  expect(made.status(), await made.text()).toBe(201);
  const agent = (await made.json()) as { id: string };
  /** How far the owner's agent stands from them, once it follows and stands still. */
  const agentDistance = async () => {
    const [body, pose] = [await bodyOf(owner, agent.id), await navPose(owner)];
    return body && body.mode === "follow" && !body.moving
      ? Math.hypot(body.x - pose.x, body.z - pose.z)
      : 99;
  };

  try {
    // The owner, in the room, off its middle: a reload brings them back to that spot.
    await owner.bringToFront();
    const room = await walkInto(owner, operation);
    if (await walkTo(owner, room.x + room.w / 2 + 1.5, room.z + room.d / 2 + 1)) {
      await waitStill(owner);
    }
    const level = await navLevel(owner);
    expect(level).not.toBe("lobby");
    await expect.poll(agentDistance, { timeout: 60_000 }).toBeLessThan(3);
    await owner.waitForTimeout(POSE_SENT_MS);
    const left = await navPose(owner);
    expect(left.room).toBe(room.id);
    if (shots) await owner.screenshot({ path: `${shots}/owner-before-reload.png` });

    await owner.reload();
    await waitForScene(owner);
    const back = await navPose(owner);
    expect(await navLevel(owner)).toBe(level);
    expect(back.room).toBe(room.id);
    expect(Math.hypot(back.x - left.x, back.z - left.z)).toBeLessThan(0.5);
    expect(angleBetween(back.heading, left.heading)).toBeLessThan(0.35);
    // Not only standing there: in the room, with its HUD, and their agent beside them.
    await expect.poll(async () => (await navPose(owner)).operationId).toBe(room.id);
    await expect(owner.locator(".rg-topbar__operation")).toHaveText(operation);
    await expect.poll(agentDistance, { timeout: 60_000 }).toBeLessThan(3);
    if (shots) await owner.screenshot({ path: `${shots}/owner-after-reload.png` });

    // The member is given the room and walks in.
    await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "read");
    await checkGitHubNow(member);
    // The member's operation list (and with it room access) refreshes on reload.
    await member.reload();
    await waitForScene(member);
    await member.bringToFront();
    await walkInto(member, operation);
    await waitStill(member);
    await member.waitForTimeout(POSE_SENT_MS);
    if (shots) await member.screenshot({ path: `${shots}/member-in-the-room.png` });

    // They close the tab; while they are away GitHub takes the room from them.
    await member.goto("about:blank");
    await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "none");
    await expect
      .poll(
        async () =>
          (await member.request.post(`${origin}/api/github/link/check`, { headers })).status(),
        { timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .toBe(200);

    // Back in the office: the lobby spawn, as for anyone who arrives, and not a word about the room.
    await member.goto(`${origin}${OFFICE_PROBE_PATH}`);
    await waitForScene(member);
    expect(await navLevel(member)).toBe("lobby");
    const lobby = (await navRooms(member)).find((r) => r.kind === "lobby");
    if (!lobby) throw new Error("no lobby");
    const arrived = await navPose(member);
    expect(arrived.room).toBe(lobby.id);
    expect(
      Math.hypot(arrived.x - (lobby.x + lobby.w / 2), arrived.z - (lobby.z + lobby.d / 2)),
    ).toBeLessThan(0.5);
    expect((await navLevels(member)).map((l) => l.levelId)).toEqual(["lobby"]);
    await member.waitForTimeout(2_000);
    await expect(member.locator(".rg-toast")).toHaveCount(0);
    expect(await member.evaluate(() => document.body.innerText)).not.toContain(operation);
    expect(await navLevel(member)).toBe("lobby");
    await expect(member.locator(".rg-topbar__operation")).toHaveText("Lobby");
    if (shots) await member.screenshot({ path: `${shots}/member-back-in-the-lobby.png` });
  } finally {
    await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "none");
    await owner.request.delete(`/api/office-agents/${agent.id}`, { headers });
  }
  await walkToLobby(owner);
  // Both pages were loaded anew here. A first gesture again, as `openOffice` gives every page:
  // a browser plays sound only after one, and the jukebox step comes next.
  for (const page of [member, owner]) {
    await page.bringToFront();
    await page.getByRole("navigation", { name: "Rooms" }).getByRole("heading").click();
  }
}
