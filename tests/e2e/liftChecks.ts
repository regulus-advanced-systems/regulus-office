/**
 * The lift in the office e2e (#269, SPEC D26): the lair's levels are joined by one lift.
 * The owner walks up to the lift in the lobby and presses `E`; its panel lists the levels they
 * can reach (the lobby level and the level of Apollo's repo owner) and nothing about rooms.
 * They ride down: the world becomes that level, they stand on its lift landing (not a copy of
 * the lobby), Apollo is on the map, and the member, still in the lobby, no longer sees them
 * there but reads which level they are on in "Who's where". Then the owner rides back up from
 * the landing and is in the lobby again, seen by the member.
 *
 * Walks by nav state and reads levels through `window.__regulusNav` (compoundProbes.ts).
 */
import { expect, type Page } from "@playwright/test";
import {
  closedDoorSpot,
  goToLobbyLevel,
  liftSpot,
  navLevel,
  navLevels,
  navPose,
  navRooms,
  rideLiftTo,
  travelButton,
  waitStill,
  walkTo,
} from "./compoundProbes.ts";
import { MEMBER_GITHUB } from "./fakeGitHub.ts";
import { checkGitHubNow, officeGitHubUrl, setRepoPermission } from "./githubAccess.ts";
import { remoteHumans, waitForScene } from "./probes.ts";

const LOBBY = "lobby";

export async function checkLift(owner: Page, member: Page, ownerName: string): Promise<void> {
  await goToLobbyLevel(member);
  await goToLobbyLevel(owner);
  await expect.poll(() => remoteHumans(member)).toHaveLength(1);

  // The levels this viewer is shown: the lobby level, then the level of Apollo's repo owner.
  const levels = await navLevels(owner);
  expect(levels[0]).toEqual({ levelId: LOBBY, name: "Lobby level", mark: "L" });
  const apollo = (await owner.evaluate(`window.__regulusNav.levelOf("Apollo")`)) as {
    levelId: string;
    name: string;
  } | null;
  if (!apollo) throw new Error("Apollo's level is not published");
  const below = levels.find((l) => l.levelId === apollo.levelId);
  expect(below?.mark).toMatch(/^S\d+$/);
  const lobbyLift = await liftSpot(owner);
  if (!lobbyLift) throw new Error("no lift in the lobby");

  // Down: the panel names the levels, and no rooms.
  const listed = await rideLiftTo(owner, apollo.levelId);
  expect(listed).toEqual(levels.map((l) => l.name));
  expect(listed).not.toContain("Apollo");
  expect(await navLevel(owner)).toBe(apollo.levelId);
  // The rider stepped out of the lift onto that level's landing: the same shaft, another hall.
  const landed = await navPose(owner);
  expect(landed.room).toBe("landing");
  expect(Math.hypot(landed.x - lobbyLift.x, landed.z - lobbyLift.z)).toBeLessThan(0.5);
  const rooms = await navRooms(owner);
  expect(rooms.map((r) => r.kind).filter((k) => k !== "project")).toEqual(["landing"]);
  expect(rooms.some((r) => r.name === "Apollo")).toBe(true);
  await expect(owner.getByTestId("location")).toHaveText("Lift landing");
  await expect(owner.getByTestId("level")).toHaveText(apollo.name);
  await expect(owner.getByTestId("lift-arrived")).toHaveText(`The lift arrived: ${apollo.name}.`);

  // The member, in the lobby, no longer sees the owner there. Their GitHub account sees no
  // repo on that level (#270), so "Who's where" does not name it to them either.
  await expect.poll(() => remoteHumans(member)).toHaveLength(0);
  const where = member.getByTestId("whereabouts");
  await expect(where).not.toContainText(apollo.name);
  await expect(where).not.toContainText("Apollo");
  const row = where.locator("li", { hasText: ownerName });

  // Back up, from the landing's lift.
  await rideLiftTo(owner, LOBBY);
  expect(await navLevel(owner)).toBe(LOBBY);
  const back = await navPose(owner);
  expect((await navRooms(owner)).find((r) => r.id === back.room)?.kind).toBe("lobby");
  await expect(owner.getByTestId("location")).toHaveText("Lobby");
  await expect.poll(() => remoteHumans(member)).toHaveLength(1);
  await expect(row).toContainText("Lobby");
}

/**
 * A level with one open and one closed room (#269, #270; SPEC D26). The owner's level has two
 * rooms, `open` and `shut` (room names), for the repos `openRepo` and another the member's
 * GitHub account cannot see. Once the member can see `openRepo`, the lift stops at that level
 * for them too: they ride down, walk into `open`, and find `shut` as a sealed door with nothing
 * on it: no name anywhere on their page, no way in on foot, by quick travel or with `E`, which
 * gets the plain "no entry" notice. Taking the permission away again leaves them with the
 * lobby level only.
 */
export async function checkOpenAndClosedRooms(
  owner: Page,
  member: Page,
  open: string,
  openRepo: string,
  shut: string,
): Promise<void> {
  await goToLobbyLevel(member);
  const level = (await owner.evaluate(`window.__regulusNav.levelOf(${JSON.stringify(open)})`)) as {
    levelId: string;
    name: string;
  } | null;
  if (!level) throw new Error(`${open}'s level is not published to the owner`);
  // Until GitHub says so, the level is not there for the member: the lift has only the lobby.
  expect((await navLevels(member)).map((l) => l.levelId)).toEqual([LOBBY]);

  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, openRepo, "read");
  await checkGitHubNow(member);
  // The member's operation list (and with it room access) refreshes on reload.
  await member.reload();
  await waitForScene(member);
  await expect
    .poll(async () => (await navLevels(member)).map((l) => l.levelId))
    .toEqual([LOBBY, level.levelId]);
  const listed = await rideLiftTo(member, level.levelId);
  expect(listed).toEqual(["Lobby level", level.name]);

  // On the level: the landing, the room they may enter, and one closed room that is a footprint.
  const rooms = await navRooms(member);
  expect(rooms.find((r) => r.name === open)).toMatchObject({ enterable: true, closed: false });
  const closed = rooms.filter((r) => r.closed);
  expect(closed).toHaveLength(1);
  expect(closed[0]).toMatchObject({ name: "", enterable: false });
  const ownerSees = (await navRooms(owner)).find((r) => r.name === shut);
  if ((await navLevel(owner)) !== level.levelId) await rideLiftTo(owner, level.levelId);
  const shutRoom = ownerSees ?? (await navRooms(owner)).find((r) => r.name === shut);
  expect(closed[0]?.id).toBe(shutRoom?.id);
  // Nothing on the member's page says what it is: not the scene's state, not quick travel.
  const state = await member.evaluate(() => document.body.innerText);
  expect(state).not.toContain(shut);
  await member.bringToFront();
  await member.keyboard.press("f");
  const travel = member.getByRole("dialog", { name: "Quick travel" });
  await expect(travel.getByRole("button", { name: new RegExp(`^${open}`) })).toBeVisible();
  await expect(travel).not.toContainText(shut);
  await member.keyboard.press("Escape");
  await expect(travel).toHaveCount(0);
  expect(await (await member.request.get("/api/compound")).text()).not.toContain(shut);

  // No way in on foot; `E` at its sealed door gets the plain notice.
  const inside = closed[0];
  if (!inside) throw new Error("no closed room");
  const door = await closedDoorSpot(member, inside.id);
  if (!door) throw new Error("no closed door");
  await expect(async () => {
    const pose = await navPose(member);
    if (!pose.walking && Math.hypot(pose.x - door.x, pose.z - door.z) <= 1) return;
    if (!pose.walking) expect(await walkTo(member, door.x, door.z)).toBe(true);
    throw new Error("walking to the closed door");
  }).toPass({ timeout: 90_000, intervals: [500, 1_000] });
  await walkTo(member, inside.x + inside.w / 2, inside.z + inside.d / 2);
  await waitStill(member);
  expect((await navPose(member)).room).not.toBe(inside.id);
  await member.keyboard.press("e");
  await expect(member.getByText("You do not have access to this room.")).toBeVisible();

  // The room they may enter opens as any room does (quick travel to its door, then in; a
  // long wait, because software GL on a loaded machine draws few frames).
  const target = rooms.find((r) => r.name === open);
  if (!target) throw new Error(`no ${open}`);
  await member.keyboard.press("f");
  await travelButton(travel, open).click();
  await expect(travel).toHaveCount(0);
  await expect(async () => {
    const pose = await navPose(member);
    if (pose.room === target.id && pose.operationId === target.id) return;
    if (!pose.walking) expect(await walkTo(member, target.inside.x, target.inside.z)).toBe(true);
    throw new Error(`walking into ${open}`);
  }).toPass({ timeout: 180_000, intervals: [500, 1_000] });

  // Access taken away again: the level is gone for them, and they are on the lobby level.
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, openRepo, "none");
  await checkGitHubNow(member);
  await expect.poll(() => navLevel(member), { timeout: 30_000 }).toBe(LOBBY);
  await expect.poll(async () => (await navLevels(member)).map((l) => l.levelId)).toEqual([LOBBY]);
  await goToLobbyLevel(owner);
}
