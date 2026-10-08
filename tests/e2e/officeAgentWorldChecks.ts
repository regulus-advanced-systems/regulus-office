/**
 * Office agents in the world, across two browsers (#252). The owner makes a personal agent
 * (secretary form) and a shared one over REST, as Settings → Agents does. Then:
 *
 * - both browsers see both bodies; the owner's agent stands beside them and follows them
 *   into the war room, and the member sees it there with "<owner>'s assistant" over it;
 * - the member clicks it: no chat opens (a toast says whose it is), and the server refuses
 *   them its chat, its dismiss and its recall;
 * - the owner presses `E` next to it: its chat opens as a window in the world; Dismiss
 *   sends it wandering for both browsers and Recall brings it back;
 * - the shared agent wanders, and both the owner and the member open its chat by clicking it;
 * - the owner walks into a project room on another level: the agent comes too, and the
 *   member, whose GitHub access does not cover that room, is not sent its body meanwhile.
 *
 * No message is sent (this office has no runner): turns are covered with the fake engine in
 * apps/server/src/pm. Bodies are read through the scene probe (`window.__regulusR3F`,
 * `?stats`): groups named `office-agent-<id>` carry what they show in `userData`.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  goToLobbyLevel,
  type NavRoom,
  navPose,
  navRooms,
  waitStill,
  walkInto,
  walkTo,
  walkToLobby,
  wheelZoomTo,
} from "./compoundProbes.ts";
import { recordToasts, toastsSeen } from "./probes.ts";

interface SceneBody {
  name: string;
  caption: string;
  mode: string;
  appearance: string;
  own: boolean;
  canChat: boolean;
  hidden: boolean;
  moving: boolean;
  x: number;
  z: number;
  bubbleKind: string;
  bubbleText: string;
  /** Where its chest is on screen. */
  sx: number;
  sy: number;
}

/** A body as this page draws it, or null when it is not in the scene (or out of sight). */
function bodyOf(page: Page, agentId: string): Promise<SceneBody | null> {
  return page.evaluate((id) => {
    type V = { x: number; y: number; z: number; clone(): V; project(c: unknown): V };
    type Obj = {
      visible: boolean;
      position: V;
      userData: Record<string, unknown>;
      getWorldPosition(v: V): V;
    };
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          scene: { getObjectByName(n: string): Obj | undefined };
          get(): { camera: unknown; gl: { domElement: HTMLCanvasElement } };
        };
      }
    ).__regulusR3F;
    const o = r3f?.scene.getObjectByName(`office-agent-${id}`);
    if (!r3f || !o || !o.visible) return null;
    const { camera, gl } = r3f.get();
    const rect = gl.domElement.getBoundingClientRect();
    const chest = o.getWorldPosition(o.position.clone());
    chest.y = 1.05;
    const p = chest.project(camera);
    return {
      ...(o.userData as unknown as Omit<SceneBody, "sx" | "sy">),
      sx: rect.left + ((p.x + 1) / 2) * rect.width,
      sy: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }, agentId);
}

const inRoom = (room: NavRoom, p: { x: number; z: number } | null) =>
  !!p && p.x >= room.x && p.x <= room.x + room.w && p.z >= room.z && p.z <= room.z + room.d;

/** Walk to the middle of a fixed room (the war room, the lobby) and stand there. */
async function standIn(page: Page, room: NavRoom, dx = 0, dz = 0): Promise<void> {
  await expect(async () => {
    const pose = await navPose(page);
    if (!pose.walking && pose.room === room.id) return;
    if (!pose.walking) await walkTo(page, room.x + room.w / 2 + dx, room.z + room.d / 2 + dz);
    throw new Error(`walking into ${room.name}`);
  }).toPass({ timeout: 90_000, intervals: [500, 1_000] });
  await waitStill(page);
}

/** Click a body (walking over to it when it is out of view) until `done` holds. */
async function clickBody(page: Page, agentId: string, done: () => Promise<boolean>) {
  await page.bringToFront();
  await expect(async () => {
    if (await done()) return;
    const body = await bodyOf(page, agentId);
    if (!body) throw new Error("the agent is not in view");
    const view = page.viewportSize() ?? { width: 1280, height: 800 };
    const inside =
      body.sx > 300 && body.sx < view.width - 280 && body.sy > 150 && body.sy < view.height - 180;
    if (!inside || body.moving) {
      // Walk over (stopping a little short), so the camera brings it into view.
      if (!inside && !(await navPose(page)).walking) await walkTo(page, body.x + 1.6, body.z + 1.2);
      throw new Error("waiting for the agent to stand in view");
    }
    await page.mouse.click(body.sx, body.sy);
    await expect.poll(done, { timeout: 2_500 }).toBe(true);
  }).toPass({ timeout: 90_000, intervals: [400, 800] });
}

export async function checkAgentsInTheWorld(owner: Page, member: Page, shots?: string) {
  const n = test.info().repeatEachIndex + 1;
  const origin = new URL(owner.url()).origin;
  const headers = { origin };
  const me = (await (await owner.request.get("/api/me")).json()) as {
    id: string;
    displayName: string;
  };
  const base = { engine: "cli-session", provider: "claude-code", model: "sonnet" };
  const made = async (data: object) => {
    const res = await owner.request.post("/api/office-agents", { data, headers });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()) as { id: string; name: string };
  };
  // A shared agent names an office key; this office's own database gets a placeholder row
  // (seedOfficeKey.ts). Against an external office the shared agent's part is left out.
  const dbPath = process.env.E2E_DATA_DIR ? join(process.env.E2E_DATA_DIR, "office.db") : "";
  const profileId = dbPath ? randomUUID() : "";
  const seed = (action: "add" | "remove") =>
    execFileSync("bun", [join(import.meta.dirname, "seedOfficeKey.ts"), dbPath, action, profileId]);
  if (dbPath) seed("add");
  const mine = await made({
    ...base,
    name: `Moneypenny ${n}`,
    owner: "me",
    role: "assistant",
    appearance: "secretary",
  });
  const shared = dbPath
    ? await made({
        ...base,
        name: `Number Two ${n}`,
        owner: "office",
        role: "custom",
        appearance: "number_two",
        profileId,
      })
    : null;

  try {
    // Everyone in the lobby, on the lobby level.
    for (const page of [owner, member]) {
      await page.bringToFront();
      await goToLobbyLevel(page);
      await walkToLobby(page);
    }
    const rooms = await navRooms(owner);
    const lobby = rooms.find((r) => r.kind === "lobby");
    const war = rooms.find((r) => r.kind === "conference");
    if (!lobby || !war) throw new Error("no lobby or war room");
    await standIn(owner, lobby, 1.5, 1);
    await standIn(member, lobby, -2.5, 1.5);
    // For the screenshots, look from close by.
    if (shots) {
      for (const page of [owner, member]) {
        await page.bringToFront();
        await page.locator("canvas").first().hover();
        await wheelZoomTo(page, 0.05);
      }
    }

    // Both browsers see both bodies, in the forms chosen for them.
    for (const page of [owner, member]) {
      await expect.poll(async () => (await bodyOf(page, mine.id))?.name).toBe(mine.name);
      if (shared)
        await expect.poll(async () => (await bodyOf(page, shared.id))?.name).toBe(shared.name);
      expect((await bodyOf(page, mine.id))?.appearance).toBe("secretary");
    }

    // The owner's agent stands beside them; for the member it is "<owner>'s assistant".
    await owner.bringToFront();
    await expect
      .poll(async () => {
        const [body, pose] = [await bodyOf(owner, mine.id), await navPose(owner)];
        return body && body.mode === "follow" && !body.moving
          ? Math.hypot(body.x - pose.x, body.z - pose.z)
          : 99;
      })
      .toBeLessThan(3);
    expect(await bodyOf(owner, mine.id)).toMatchObject({
      own: true,
      canChat: true,
      caption: "Your assistant",
    });
    if (shots) await owner.screenshot({ path: `${shots}/personal-agent-beside-owner.png` });

    // It follows them out of the lobby and into the war room.
    await standIn(owner, war);
    await expect
      .poll(async () => {
        const body = await bodyOf(owner, mine.id);
        return !!body && !body.moving && inRoom(war, body);
      })
      .toBe(true);
    const ownerPose = await navPose(owner);
    const beside = await bodyOf(owner, mine.id);
    expect(Math.hypot((beside?.x ?? 0) - ownerPose.x, (beside?.z ?? 0) - ownerPose.z)).toBeLessThan(
      3,
    );

    // The member comes to look: the same body, in the same room, with whose it is over it.
    await standIn(member, war, 2, 2);
    await member.bringToFront();
    await expect
      .poll(async () => {
        const body = await bodyOf(member, mine.id);
        return !!body && !body.moving && inRoom(war, body);
      })
      .toBe(true);
    const seen = await bodyOf(member, mine.id);
    expect(seen).toMatchObject({
      own: false,
      canChat: false,
      caption: `${me.displayName}'s assistant`,
      bubbleKind: "doing",
      bubbleText: `${me.displayName}'s assistant`,
    });
    // Everyone sees it in the same place (the server sent one target).
    const mineNow = await bodyOf(owner, mine.id);
    expect(
      Math.hypot((seen?.x ?? 0) - (mineNow?.x ?? 0), (seen?.z ?? 0) - (mineNow?.z ?? 0)),
    ).toBeLessThan(1);
    if (shots) await member.screenshot({ path: `${shots}/other-persons-view.png` });

    // The member clicks it: no chat, a line saying whose it is. The server says the same.
    await recordToasts(member);
    await clickBody(member, mine.id, async () =>
      (await toastsSeen(member)).some((t) => t.includes(`Only ${me.displayName} can talk to it`)),
    );
    await expect(member.getByRole("dialog", { name: mine.name })).toHaveCount(0);
    for (const path of ["messages", "dismiss", "recall", "seen"]) {
      const res = await member.request.post(`/api/office-agents/${mine.id}/${path}`, {
        data: { text: "hello" },
        headers,
      });
      expect(res.status(), path).toBe(404);
    }
    expect((await member.request.get(`/api/office-agents/${mine.id}/conversation`)).status()).toBe(
      404,
    );

    // The owner presses E next to it: its chat opens as a window in the world. Out in the
    // corridor, where nothing else is in reach of E (by a chair, E sits down first).
    await owner.bringToFront();
    const corridor = { x: lobby.x + lobby.w / 2, z: lobby.z - 2 };
    await expect(async () => {
      const pose = await navPose(owner);
      const there = Math.hypot(pose.x - corridor.x, pose.z - corridor.z) < 1;
      if (!there && !pose.walking) await walkTo(owner, corridor.x, corridor.z);
      const body = await bodyOf(owner, mine.id);
      expect(there && !pose.walking && !!body && !body.moving).toBe(true);
      expect(Math.hypot((body?.x ?? 0) - pose.x, (body?.z ?? 0) - pose.z)).toBeLessThan(2.2);
    }).toPass({ timeout: 90_000, intervals: [500, 1_000] });
    await owner.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await owner.locator("canvas").first().hover();
    const chat = owner.getByRole("dialog", { name: mine.name });
    await expect(async () => {
      if (await chat.isVisible()) return;
      await owner.keyboard.press("e");
      await expect(chat).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(chat).toContainText("Your assistant, at your side.");
    await expect(chat.getByRole("list", { name: `Chat with ${mine.name}` })).toBeVisible();
    await expect(chat.getByLabel(`Message to ${mine.name}`)).toBeVisible();
    if (shots) await owner.screenshot({ path: `${shots}/chat-window-from-the-world.png` });

    // Dismiss: it goes off on its own, for both browsers. Recall: back to the owner's side.
    await chat.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(chat.getByRole("button", { name: "Recall to my side" })).toBeVisible();
    await expect(chat).toContainText("roaming the lair");
    for (const page of [owner, member]) {
      await expect
        .poll(async () => (await bodyOf(page, mine.id))?.mode ?? "wander", { timeout: 20_000 })
        .toBe("wander");
    }
    await chat.getByRole("button", { name: "Recall to my side" }).click();
    await expect(chat.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
    await chat.getByRole("button", { name: "Done" }).click();
    await expect(chat).toHaveCount(0);
    for (const page of [owner, member]) {
      await expect
        .poll(async () => (await bodyOf(page, mine.id))?.mode, { timeout: 20_000 })
        .toBe("follow");
    }

    // The shared agent wanders: it is sent somewhere else before long.
    if (shared) {
      await standIn(owner, lobby, 1.5, 1);
      await standIn(member, lobby, -2.5, 1.5);
      await owner.bringToFront();
      const first = await bodyOf(owner, shared.id);
      expect(first).toMatchObject({
        mode: "wander",
        own: false,
        canChat: true,
        caption: "Office agent",
      });
      await expect
        .poll(
          async () => {
            const now = await bodyOf(owner, shared.id);
            return now ? Math.hypot(now.x - (first?.x ?? 0), now.z - (first?.z ?? 0)) : 0;
          },
          { timeout: 60_000 },
        )
        .toBeGreaterThan(1.5);
      if (shots) {
        await expect
          .poll(
            async () => {
              const b = await bodyOf(owner, shared.id);
              return (
                !!b && inRoom(lobby, b) && b.sx > 200 && b.sx < 1080 && b.sy > 150 && b.sy < 650
              );
            },
            { timeout: 120_000 },
          )
          .toBe(true);
        await owner.screenshot({ path: `${shots}/shared-agent-wandering-the-lobby.png` });
      }

      // Both of them open its chat by clicking it.
      for (const page of [owner, member]) {
        const dialog = page.getByRole("dialog", { name: shared.name });
        await clickBody(page, shared.id, () => dialog.isVisible());
        await expect(dialog).toContainText("Office agent, shared by the office.");
        await expect(dialog.getByLabel(`Message to ${shared.name}`)).toBeVisible();
        // Nobody dismisses a shared agent.
        await expect(dialog.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
        await dialog.getByRole("button", { name: "Done" }).click();
        await expect(dialog).toHaveCount(0);
      }
    }

    // Into a project room on another level: the owner's agent comes along.
    if (process.env.E2E_DATA_DIR) {
      await owner.bringToFront();
      const apollo = await walkInto(owner, "Apollo");
      await expect
        .poll(
          async () => {
            const body = await bodyOf(owner, mine.id);
            return !!body && !body.moving && body.mode === "follow" && inRoom(apollo, body);
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      // The member's GitHub access does not cover Apollo: while the agent is in there, their
      // browser is not sent its body at all (per-viewer state, #270), and gets it back after.
      const theirs = (await (await member.request.get("/api/operations")).json()) as {
        operations: Array<{ name: string }>;
      };
      const memberSeesApollo = theirs.operations.some((o) => o.name === "Apollo");
      if (!memberSeesApollo) {
        await expect.poll(() => bodyOf(member, mine.id), { timeout: 15_000 }).toBeNull();
      }
      await goToLobbyLevel(owner);
      await walkToLobby(owner);
      await expect
        .poll(async () => (await bodyOf(member, mine.id))?.name, { timeout: 30_000 })
        .toBe(mine.name);
    }
  } finally {
    // Leave nothing behind, so the step can run again.
    for (const agent of [mine, shared]) {
      if (agent) await owner.request.delete(`/api/office-agents/${agent.id}`, { headers });
    }
    if (dbPath) seed("remove");
  }
  // The bodies go with their agents.
  for (const page of [owner, member]) {
    await expect.poll(() => bodyOf(page, mine.id), { timeout: 15_000 }).toBeNull();
  }
}
