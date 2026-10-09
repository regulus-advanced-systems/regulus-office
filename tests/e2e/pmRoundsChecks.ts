/**
 * The office PM in the world (#60), in the henchman flow, while the owner's henchman waits for
 * approval. The owner makes the office's project manager over REST (as Settings → Agents does).
 * Then:
 *
 * - with no room granted yet it has no round to walk: it stands at the reception desk in the
 *   lobby in the PM suit (none was chosen); the owner walks up to the desk and presses `E`:
 *   its chat opens as a window;
 * - the owner grants it the henchman's room. On its next round (this office walks them back
 *   to back, `OFFICE_PM_ROUND_SECONDS=5`, with short stops) it comes into the room and stands
 *   next to the waiting henchman with a line over its head; the member, in the room, sees it;
 * - the owner, in the lobby, gets the "needs you" notice with "Take me there";
 * - the next round stands by the same henchman, and no second notice comes;
 * - the owner goes to the room: the request is there for them to answer.
 *
 * No message is sent to the PM and no model is called: the rounds are movement only. Nothing
 * here waits a fixed time: every wait is for something the pages show. Leaves the flow as it
 * found it: the PM is removed, and the owner is back in the room with the permission prompt.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { scenePoint } from "./agentProbes.ts";
import {
  goToLobbyLevel,
  navPose,
  roomNamed,
  travelInto,
  waitStill,
  walkTo,
  walkToLobby,
  wheelZoomTo,
} from "./compoundProbes.ts";
import { bodyOf, receptionStand, sceneXZ } from "./officeAgentProbes.ts";
import { recordToasts, toastsSeen } from "./probes.ts";

export interface PmRoundsInput {
  /** The office's own database (a throwaway one this run started). */
  dbPath: string;
  operation: string;
  henchmanId: string;
  henchmanName: string;
  ownerName: string;
  /** Directory for screenshots; none when left out. */
  shots?: string;
}

const REMINDER = "stopped by on its round";

export async function checkPmRounds(owner: Page, member: Page, input: PmRoundsInput) {
  const headers = { origin: new URL(owner.url()).origin };
  const prompt = owner.getByRole("dialog", { name: "Permission needed" });
  const line = `${input.henchmanName} is waiting for ${input.ownerName}`;

  // A shared agent names an office key; this office's own database gets a placeholder row
  // (seedOfficeKey.ts). Nothing is ever sent with it.
  const profileId = randomUUID();
  const seed = (action: "add" | "remove") =>
    execFileSync("bun", [
      join(import.meta.dirname, "seedOfficeKey.ts"),
      input.dbPath,
      action,
      profileId,
    ]);
  seed("add");
  const created = await owner.request.post("/api/office-agents", {
    data: {
      engine: "cli-session",
      provider: "claude-code",
      model: "sonnet",
      name: "Ledger",
      owner: "office",
      role: "pm",
      profileId,
    },
    headers,
  });
  expect(created.status(), await created.text()).toBe(201);
  const pm = (await created.json()) as { id: string; name: string; appearance: string };
  // No look was chosen: a project manager wears the PM suit.
  expect(pm.appearance).toBe("number_two");
  // A stopped agent has no body (#301): it is started, as its first message would.
  const started = await owner.request.post(`/api/office-agents/${pm.id}/start`, { headers });
  expect(started.status(), await started.text()).toBe(200);

  try {
    const operations = (await (await owner.request.get("/api/operations")).json()) as {
      operations: Array<{ operationId: string; name: string }>;
    };
    const operationId = operations.operations.find((o) => o.name === input.operation)?.operationId;
    if (!operationId) throw new Error(`no operation ${input.operation}`);

    // The owner leaves the room for the lobby: from now on they are "elsewhere".
    await owner.bringToFront();
    await owner.keyboard.press("Escape");
    await expect(prompt).toHaveCount(0);
    await recordToasts(owner);
    await goToLobbyLevel(owner);
    await walkToLobby(owner);

    // Reception: with no room to visit, the PM stands behind the counter, in the PM suit.
    const stand = await receptionStand(owner);
    if (!stand) throw new Error("no reception desk in the scene");
    await expect(async () => {
      const pose = await navPose(owner);
      const there = Math.hypot(pose.x - stand.x, pose.z - stand.z) < 1;
      if (!there && !pose.walking) await walkTo(owner, stand.x, stand.z);
      expect(there && !pose.walking).toBe(true);
    }).toPass({ timeout: 90_000, intervals: [250, 500] });
    if (input.shots) {
      await owner.locator("canvas").first().hover();
      await wheelZoomTo(owner, 0.22);
    }
    await expect
      .poll(
        async () => {
          const b = await bodyOf(owner, pm.id);
          return b && !b.moving ? { mode: b.mode, text: b.bubbleText } : null;
        },
        { timeout: 30_000, intervals: [250] },
      )
      .toEqual({ mode: "post", text: "at reception" });
    const atDesk = await bodyOf(owner, pm.id);
    expect(atDesk).toMatchObject({
      name: pm.name,
      appearance: "number_two",
      caption: "Office agent",
      canChat: true,
      own: false,
    });
    // Behind the counter, across it from the visitor.
    expect(Math.hypot((atDesk?.x ?? 0) - stand.x, (atDesk?.z ?? 0) - stand.z)).toBeLessThan(4);
    expect(atDesk?.x ?? 99).toBeLessThan(stand.x - 1.5);
    if (input.shots) await owner.screenshot({ path: `${input.shots}/pm-at-reception.png` });

    // Walking up to the desk and pressing E opens its chat.
    await owner.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await owner.locator("canvas").first().hover();
    const chat = owner.getByRole("dialog", { name: pm.name });
    await expect(async () => {
      if (await chat.isVisible()) return;
      await owner.keyboard.press("e");
      await expect(chat).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(chat).toContainText("Office agent, shared by the office.");
    await expect(chat.getByLabel(`Message to ${pm.name}`)).toBeVisible();
    if (input.shots) await owner.screenshot({ path: `${input.shots}/chat-at-the-desk.png` });
    await chat.getByRole("button", { name: "Done" }).click();
    await expect(chat).toHaveCount(0);

    // Granted the room, its next round brings it to the boards and then next to the waiting
    // henchman. The line is published when it sets off: it counts once it stands there.
    const granted = await owner.request.put(`/api/office-agents/${pm.id}/grants`, {
      data: { grants: [{ operationId, access: "view" }] },
      headers,
    });
    expect(granted.status(), await granted.text()).toBe(200);
    const beside = async () => {
      const [b, h] = [
        await bodyOf(member, pm.id),
        await sceneXZ(member, `henchman-${input.henchmanId}`),
      ];
      if (!b || !h || b.moving || b.bubbleText !== line) return null;
      const gap = Math.hypot(b.x - h.x, b.z - h.z);
      return gap > 2.5 ? null : { mode: b.mode, gap, x: b.x, z: b.z };
    };
    type Visit = NonNullable<Awaited<ReturnType<typeof beside>>>;
    const visits = { count: 0, there: false, leftAt: 0, first: null as Visit | null };
    const words = new Set<string>();
    /** Look once: note what is over its head, and count each time it comes to stand there. */
    const look = async () => {
      const b = await bodyOf(member, pm.id);
      if (b && !b.moving && b.bubbleText) words.add(b.bubbleText);
      const now = await beside();
      // A new visit only after it has been away a while (a frame of turning is not leaving).
      if (now && !visits.there && Date.now() - visits.leftAt > 1_500) {
        visits.count += 1;
        visits.first ??= now;
      }
      if (!now && visits.there) visits.leftAt = Date.now();
      visits.there = now !== null;
      return visits;
    };
    await member.bringToFront();
    const room = await roomNamed(member, input.operation);
    if (input.shots) {
      await member.locator("canvas").first().hover();
      await wheelZoomTo(member, 0.12);
    }
    await expect
      .poll(async () => (await look()).count, { timeout: 120_000, intervals: [100] })
      .toBe(1);
    if (input.shots) {
      await member.screenshot({ path: `${input.shots}/pm-beside-a-waiting-henchman.png` });
    }
    const stood = visits.first;
    // Next to the henchman, inside the room it was granted.
    expect(stood?.mode).toBe("route");
    expect(stood?.gap ?? 99).toBeLessThan(2);
    expect(stood?.gap ?? 0).toBeGreaterThan(0.5);
    expect(stood && stood.x > room.x && stood.x < room.x + room.w).toBe(true);
    expect(stood && stood.z > room.z && stood.z < room.z + room.d).toBe(true);

    // The owner, in the lobby, gets the "needs you" notice once it stands there, with the way
    // to the henchman on it.
    const reminders = async () => (await toastsSeen(owner)).filter((t) => t.includes(REMINDER));
    await expect
      .poll(
        async () => {
          await look();
          return (await reminders()).length;
        },
        { timeout: 60_000, intervals: [100] },
      )
      .toBe(1);
    const [notice] = await reminders();
    expect(notice).toContain(input.henchmanName);
    expect(notice).toContain(`${pm.name} ${REMINDER}`);
    expect(notice).toContain("Take me there");

    // The next round stands by the same henchman again and moves on (the office tells the
    // owner when it gets there, so by the time it has left, a second notice would be out).
    // The owner, still elsewhere, has heard once.
    await expect
      .poll(async () => (await look()).count, { timeout: 120_000, intervals: [100] })
      .toBe(2);
    await expect
      .poll(async () => (await look()).there, { timeout: 60_000, intervals: [100] })
      .toBe(false);
    expect(await reminders()).toHaveLength(1);
    // Nothing else was over its head on the way (as far as the page drew it standing):
    // it came up by the lift (#269) and stopped at the boards.
    expect(
      [...words].filter(
        (w) => !/^(checking the (issue|PR) board|stepping out of the lift)$/.test(w),
      ),
    ).toEqual([line]);
  } finally {
    await owner.request.delete(`/api/office-agents/${pm.id}`, { headers });
    seed("remove");
  }
  await expect.poll(() => bodyOf(member, pm.id), { timeout: 15_000 }).toBeNull();

  // Back as the flow was: the owner in the room, the request open in front of them.
  await owner.bringToFront();
  await travelInto(owner, input.operation);
  await expect(async () => {
    if (await prompt.isVisible()) return;
    const point = await scenePoint(owner, `agent-bubble-${input.henchmanId}`);
    if (!point) throw new Error("the bubble is not in the scene");
    await owner.mouse.click(point.x, point.y - 10);
    await expect(prompt).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}
