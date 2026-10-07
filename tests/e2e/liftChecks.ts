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
  goToLobbyLevel,
  liftSpot,
  navLevel,
  navLevels,
  navPose,
  navRooms,
  rideLiftTo,
} from "./compoundProbes.ts";
import { remoteHumans } from "./probes.ts";

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

  // The member, in the lobby, no longer sees the owner there; "Who's where" says which level.
  await expect.poll(() => remoteHumans(member)).toHaveLength(0);
  const row = member.getByTestId("whereabouts").locator("li", { hasText: ownerName });
  await expect(row).toContainText(`On ${apollo.name}`);

  // Back up, from the landing's lift.
  await rideLiftTo(owner, LOBBY);
  expect(await navLevel(owner)).toBe(LOBBY);
  const back = await navPose(owner);
  expect((await navRooms(owner)).find((r) => r.id === back.room)?.kind).toBe("lobby");
  await expect(owner.getByTestId("location")).toHaveText("Lobby");
  await expect.poll(() => remoteHumans(member)).toHaveLength(1);
  await expect(row).toContainText("Lobby");
}
