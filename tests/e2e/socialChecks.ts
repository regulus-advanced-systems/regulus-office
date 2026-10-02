/**
 * The social layer across two browsers (#49): a chat line floats as a
 * bubble over the speaker on both pages, an emote picked on the wheel (hold G,
 * arrows, let go) plays on the other page, sitting on the lobby sofa with E
 * and standing up again is seen by the other page, and "Who's where" lists
 * the other human and walks there. Read through the scene probe
 * (`window.__regulusR3F`, `?stats`): bubbles are sprites named `chat-bubble`
 * under a human's group, the genius root carries the playing clip in
 * `userData.clip`, and the human group the seat in `userData.seatId`.
 */
import { expect, type Page } from "@playwright/test";
import { navPose, navRooms, waitStill, walkTo } from "./compoundProbes.ts";
import { distance, humans, remoteHumans } from "./probes.ts";

interface Social {
  bubbles: string[];
  clip: string | null;
  seatId: string;
}

/** Bubbles, clip and seat of the human group `name` (`local-human` or `human-<session>`). */
export function socialOf(page: Page, name: string): Promise<Social | null> {
  return page.evaluate((groupName) => {
    type Obj = {
      name: string;
      visible: boolean;
      userData: Record<string, unknown>;
      traverse(f: (o: Obj) => void): void;
    };
    const r3f = (window as unknown as { __regulusR3F?: { scene: Obj } }).__regulusR3F;
    let group: Obj | null = null;
    r3f?.scene.traverse((o) => {
      if (!group && o.name === groupName) group = o;
    });
    const g = group as Obj | null;
    if (!g) return null;
    const out = { bubbles: [] as string[], clip: null as string | null, seatId: "" };
    out.seatId = String(g.userData.seatId ?? "");
    g.traverse((o) => {
      if (o.name === "chat-bubble" && o.visible) out.bubbles.push(String(o.userData.text));
      if (typeof o.userData.clip === "string") out.clip = o.userData.clip;
    });
    return out;
  }, name);
}

async function only(page: Page): Promise<string> {
  await expect.poll(() => remoteHumans(page)).toHaveLength(1);
  const [name] = await remoteHumans(page);
  if (!name) throw new Error("no other human");
  return name;
}

/** Focus the scene so keys go to the office, not a panel. */
async function focusScene(page: Page): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator("canvas").first().hover();
}

export async function checkChatBubbles(owner: Page, member: Page, text: string): Promise<void> {
  const ownerOnMember = await only(member);
  const input = owner.getByTestId("chat-input");
  await input.fill(text);
  await input.press("Enter");
  await input.press("Escape");
  await expect.poll(async () => (await socialOf(owner, "local-human"))?.bubbles).toEqual([text]);
  await expect.poll(async () => (await socialOf(member, ownerOnMember))?.bubbles).toEqual([text]);
  // And it fades away on its own (CHAT_BUBBLE_MS, 6 s).
  await expect
    .poll(async () => (await socialOf(member, ownerOnMember))?.bubbles, { timeout: 15_000 })
    .toEqual([]);
}

export async function checkEmoteWheel(owner: Page, member: Page): Promise<void> {
  const ownerOnMember = await only(member);
  await focusScene(owner);
  await owner.keyboard.down("g");
  const wheel = owner.getByTestId("emote-wheel");
  await expect(wheel).toBeVisible();
  await owner.keyboard.press("ArrowRight");
  await owner.keyboard.press("ArrowRight");
  await expect(wheel.getByRole("menuitemradio", { checked: true })).toHaveAttribute(
    "data-emote",
    "thumbs_up",
  );
  await owner.waitForTimeout(300);
  await owner.keyboard.up("g");
  await expect(wheel).toHaveCount(0);
  await expect.poll(async () => (await socialOf(member, ownerOnMember))?.clip).toBe("thumbs_up");
  await expect.poll(async () => (await socialOf(owner, "local-human"))?.clip).toBe("thumbs_up");
  // One-shot: back to rest after the emote (EMOTE_MS, 2.5 s).
  await expect
    .poll(async () => (await socialOf(member, ownerOnMember))?.clip, { timeout: 15_000 })
    .toBe("idle");
}

const SOFA = "lobby/sofa-2";

export async function checkSitAndStand(owner: Page, member: Page): Promise<void> {
  const ownerOnMember = await only(member);
  const seat = (await owner.evaluate(`window.__regulusNav.humanSeat(${JSON.stringify(SOFA)})`)) as {
    x: number;
    z: number;
  } | null;
  if (!seat) throw new Error("no lobby sofa");
  // Walk up in front of the sofa (it faces north), then E.
  await expect(async () => {
    const pose = await navPose(owner);
    if (distance(pose, seat) < 1.6 && !pose.walking) return;
    if (!pose.walking) expect(await walkTo(owner, seat.x, seat.z - 1)).toBe(true);
    throw new Error("walking to the sofa");
  }).toPass({ timeout: 60_000, intervals: [500, 1_000] });
  await waitStill(owner);
  await focusScene(owner);
  await owner.keyboard.press("e");
  await expect.poll(async () => (await socialOf(owner, "local-human"))?.seatId).toBe(SOFA);
  await expect.poll(async () => (await socialOf(member, ownerOnMember))?.seatId).toBe(SOFA);
  // Seated on the sofa, not where the walk ended.
  await expect
    .poll(async () => {
      const at = (await humans(member))[ownerOnMember];
      return at ? distance(at, seat) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(0.6);
  await expect(member.getByTestId("whereabouts")).toContainText("sitting down");

  await owner.keyboard.press("e");
  await expect.poll(async () => (await socialOf(owner, "local-human"))?.seatId).toBe("");
  await expect.poll(async () => (await socialOf(member, ownerOnMember))?.seatId).toBe("");
}

/** The member's "Who's where" lists the owner in the lobby; clicking the name walks there. */
export async function checkWhereabouts(
  owner: Page,
  member: Page,
  ownerName: string,
): Promise<void> {
  const list = member.getByTestId("whereabouts");
  const row = list.locator("li", { hasText: ownerName });
  await expect(row).toContainText("Lobby");
  const ownerAt = (await humans(owner))["local-human"];
  const before = (await humans(member))["local-human"];
  if (!ownerAt || !before) throw new Error("positions missing");
  await member.bringToFront();
  await row.getByRole("button", { name: new RegExp(ownerName) }).click();
  await expect(
    member.getByRole("status").filter({ hasText: `Walking to ${ownerName}` }),
  ).toBeVisible();
  await expect
    .poll(
      async () => {
        const me = (await humans(member))["local-human"];
        return me ? distance(me, ownerAt) : Number.POSITIVE_INFINITY;
      },
      { timeout: 60_000 },
    )
    .toBeLessThan(Math.max(1.6, distance(before, ownerAt) - 0.5));
}

/**
 * Back to the middle of the lobby, clear of the sofa, so the later steps' `E` presses
 * (which would now sit down beside a seat) and clicks find open floor as before.
 */
export async function backToLobbyMiddle(page: Page): Promise<void> {
  const lobby = (await navRooms(page)).find((r) => r.kind === "lobby");
  if (!lobby) throw new Error("no lobby");
  const middle = { x: lobby.x + lobby.w / 2, z: lobby.z + lobby.d / 2 };
  await expect(async () => {
    const pose = await navPose(page);
    if (distance(pose, middle) < 1 && !pose.walking) return;
    if (!pose.walking) expect(await walkTo(page, middle.x, middle.z)).toBe(true);
    throw new Error("walking to the middle of the lobby");
  }).toPass({ timeout: 60_000, intervals: [500, 1_000] });
  await waitStill(page);
}
