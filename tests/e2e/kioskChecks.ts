/**
 * Board helpers in the office e2e, across two browsers (#56). The owner, whose GitHub access
 * opens Apollo, places a helper at Apollo's issue board and one at its queue (over REST, as
 * Settings → Agents does; the form itself is looked at too). Then:
 *
 * - the owner walks into Apollo: both helpers stand at their boards, small, in the helper's
 *   coat, called "Board helper", and stay there;
 * - the owner clicks the one at the issue board: its window opens with the board's brief on
 *   top (from the office, no model) and the chat below;
 * - the member, whose GitHub access does not cover Apollo, is never sent either body, does not
 *   find them in the list of agents, and gets "not found" for the brief, the chat and the soul;
 * - a helper cannot be let into another room, nor turned into something else.
 *
 * No message is sent (this office has no runner): the helper's turns and its short tool list
 * are covered with the fake engine in apps/server/src/pm/kiosk/kiosk.test.ts. With a
 * directory given, the screenshots for the PR are saved there. Leaves nothing behind.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  cameraSettled,
  goToLobbyLevel,
  type NavRoom,
  navPose,
  waitStill,
  walkInto,
  walkTo,
  walkToLobby,
  wheelZoomTo,
} from "./compoundProbes.ts";
import { bodyOf } from "./officeAgentProbes.ts";
import { clickBody } from "./officeAgentWorldChecks.ts";
import { screenPointOf } from "./probes.ts";

interface Helper {
  id: string;
  name: string;
  appearance: string;
  kiosk?: { operationId: string; operationName: string; board: string };
}

/**
 * Stand a few steps back from a helper, to one side, and turn the camera until the helper is
 * in the clear part of the view and not behind the player. A helper never moves, and whatever
 * view the steps before this one left is not one to rely on.
 */
async function standBefore(page: Page, room: NavRoom, helperId: string): Promise<number> {
  const at = await bodyOf(page, helperId);
  if (!at) throw new Error("the helper is not in this page's scene");
  const mid = { x: room.x + room.w / 2, z: room.z + room.d / 2 };
  const len = Math.hypot(mid.x - at.x, mid.z - at.z) || 1;
  const back = { x: (mid.x - at.x) / len, z: (mid.z - at.z) / len };
  if (await walkTo(page, at.x + back.x * 3.2 - back.z * 1.8, at.z + back.z * 3.2 + back.x * 1.8)) {
    await waitStill(page);
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator("canvas").first().hover();
  await wheelZoomTo(page, 0.14);
  const view = page.viewportSize() ?? { width: 1280, height: 800 };
  const clear = async () => {
    const body = await bodyOf(page, helperId);
    const pose = await navPose(page);
    const me = await screenPointOf(page, { x: pose.x, z: pose.z });
    return (
      !!body &&
      body.sx > 320 &&
      body.sx < view.width - 300 &&
      body.sy > 170 &&
      body.sy < view.height - 200 &&
      (!me || Math.hypot(body.sx - me.x, body.sy - me.y) > 140)
    );
  };
  // Eight turns of 45 degrees are once round.
  let turns = 0;
  for (; turns < 8 && !(await clear()); turns++) {
    await page.keyboard.press("z");
    await cameraSettled(page);
  }
  expect(await clear(), "the helper is in plain view").toBe(true);
  return turns;
}

export async function checkBoardHelpers(owner: Page, member: Page, shots?: string) {
  const dbPath = process.env.E2E_DATA_DIR ? join(process.env.E2E_DATA_DIR, "office.db") : "";
  // A helper is a shared agent and names an office key: only this run's own office can be given one.
  test.skip(!dbPath, "needs the office this run started (an office key is seeded into it)");
  const n = test.info().repeatEachIndex + 1;
  const headers = { origin: new URL(owner.url()).origin };
  const profileId = randomUUID();
  const seed = (action: "add" | "remove") =>
    execFileSync("bun", [join(import.meta.dirname, "seedOfficeKey.ts"), dbPath, action, profileId]);
  seed("add");

  const rooms = (await (await owner.request.get("/api/operations")).json()) as {
    operations: Array<{ operationId: string; name: string }>;
  };
  const apolloId = rooms.operations.find((o) => o.name === "Apollo")?.operationId ?? "";
  expect(apolloId).not.toBe("");
  const base = {
    owner: "office",
    engine: "cli-session",
    role: "kiosk",
    provider: "claude-code",
    model: "haiku",
    profileId,
  };
  const place = async (name: string, board: string) => {
    const res = await owner.request.post("/api/office-agents", {
      data: { ...base, name, kiosk: { operationId: apolloId, board } },
      headers,
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()) as Helper;
  };
  const made: Helper[] = [];
  // The view as the steps before left it: the steps after this one get it back.
  await owner.bringToFront();
  const view = await cameraSettled(owner);
  let turned = 0;

  try {
    // The form: the job is offered for a shared agent, with the rooms this person sees.
    await owner.bringToFront();
    await owner.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = owner.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("tab", { name: "Agents", exact: true }).click();
    const section = settings.getByRole("region", { name: "Office agents" });
    await section.getByRole("button", { name: "New agent…" }).click();
    const form = section.getByRole("form", { name: "New agent" });
    await expect(form.getByLabel("Job").locator("option", { hasText: "Board helper" })).toHaveCount(
      0,
    );
    await form.getByLabel("Belongs to").selectOption("office");
    await form.getByLabel("Job").selectOption("kiosk");
    await expect(form.getByLabel("Room", { exact: true }).locator("option")).toContainText([
      "Apollo",
    ]);
    await expect(form.getByLabel("Board", { exact: true }).locator("option")).toHaveText([
      "Issue board",
      "Pull request board",
      "Task queue",
    ]);
    await expect(form.getByLabel("Run it like the office's project manager")).toBeChecked();
    await form.getByLabel("Name", { exact: true }).fill(`Apollo issues ${n}`);
    if (shots) {
      await form.getByTestId("kiosk-fields").scrollIntoViewIfNeeded();
      await owner.screenshot({ path: `${shots}/place-a-board-helper.png` });
    }
    await form.getByRole("button", { name: "Cancel" }).click();
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toHaveCount(0);

    const issues = await place(`Apollo issues ${n}`, "issues");
    made.push(issues);
    const queue = await place(`Apollo queue ${n}`, "queue");
    made.push(queue);
    expect(issues).toMatchObject({
      appearance: "lab_coat",
      kiosk: { operationId: apolloId, operationName: "Apollo", board: "issues" },
    });
    // One helper per board.
    const again = await owner.request.post("/api/office-agents", {
      data: { ...base, name: `Second ${n}`, kiosk: { operationId: apolloId, board: "issues" } },
      headers,
    });
    expect([again.status(), ((await again.json()) as { error: string }).error]).toEqual([
      409,
      "kiosk_board_taken",
    ]);

    // The owner walks in: each helper is at its board, inside the room, and small.
    const apollo = await walkInto(owner, "Apollo");
    const inApollo = (p: { x: number; z: number }) =>
      p.x >= apollo.x &&
      p.x <= apollo.x + apollo.w &&
      p.z >= apollo.z &&
      p.z <= apollo.z + apollo.d;
    for (const [helper, post] of [
      [issues, "issue_board"],
      [queue, "queue_clipboard"],
    ] as const) {
      await expect
        .poll(async () => (await bodyOf(owner, helper.id))?.post, { timeout: 30_000 })
        .toBe(post);
      const body = await bodyOf(owner, helper.id);
      expect(body).toMatchObject({
        name: helper.name,
        mode: "post",
        caption: "Board helper",
        appearance: "lab_coat",
        scale: 0.8,
        own: false,
        canChat: true,
      });
      // Standing in the room. (A page that first saw it from far off has it walk in from the
      // door, so "at its post" is asked of where it stands, not of where it was sent.)
      await expect
        .poll(
          async () => {
            const now = await bodyOf(owner, helper.id);
            return !!now && !now.moving && !now.hidden && inApollo(now);
          },
          { timeout: 60_000 },
        )
        .toBe(true);
    }
    const [a, b] = [await bodyOf(owner, issues.id), await bodyOf(owner, queue.id)];
    expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0))).toBeGreaterThan(0.8);

    // In front of the issue board, with the helper in plain view.
    turned += await standBefore(owner, apollo, issues.id);
    const dialog = owner.getByRole("dialog", { name: issues.name });
    await clickBody(owner, issues.id, () => dialog.isVisible());
    await expect(dialog).toContainText("Board helper, at the issue board.");
    const brief = dialog.getByTestId("kiosk-brief");
    await expect(brief).toBeVisible();
    await expect(brief).toContainText("Issue board · Apollo");
    await expect(brief.locator("strong")).toHaveText(/open issues?\.|No open issues\./);
    await expect(brief).toContainText("nothing is queued until you confirm");
    await expect(dialog.getByLabel(`Message to ${issues.name}`)).toBeVisible();
    // Nobody dismisses a board helper.
    await expect(dialog.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
    if (shots) await owner.screenshot({ path: `${shots}/the-brief-at-the-issue-board.png` });

    // The helper proposes a task (seeded: no turn runs in this office). The owner sees all of
    // it, word for word, and nothing is queued; the member cannot reach it; "Do not queue"
    // drops it.
    const me = (await (await owner.request.get("/api/me")).json()) as { id: string };
    const proposalId = randomUUID();
    execFileSync("bun", [
      join(import.meta.dirname, "seedProposal.ts"),
      dbPath,
      proposalId,
      issues.id,
      me.id,
      apolloId,
    ]);
    const proposal = dialog.getByTestId("kiosk-proposal");
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText("Nothing is queued yet.");
    await expect(proposal).toContainText("A task Tidy the README");
    await expect(proposal).toContainText("claude-code, model sonnet");
    await expect(proposal.locator("pre")).toHaveText(
      "Read README.md and fix the three broken links in the Quickstart section.\nDo not change anything else. Open a pull request when done.",
    );
    await expect(proposal.getByRole("button", { name: "Confirm and queue" })).toBeVisible();
    if (shots) await owner.screenshot({ path: `${shots}/the-helper-proposes-a-task.png` });
    const confirmPath = `/api/office-agents/${issues.id}/proposals/${proposalId}/confirm`;
    expect((await member.request.post(confirmPath, { data: {}, headers })).status()).toBe(404);
    await proposal.getByRole("button", { name: "Do not queue" }).click();
    await expect(proposal).toHaveCount(0);
    expect((await owner.request.post(confirmPath, { data: {}, headers })).status()).toBe(409);

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    if (shots) {
      turned += await standBefore(owner, apollo, issues.id);
      await owner.screenshot({ path: `${shots}/board-helpers-at-their-boards.png` });
    }

    // It has not moved: a helper never leaves its board.
    const still = await bodyOf(owner, issues.id);
    expect(still?.mode).toBe("post");
    expect(Math.hypot((still?.x ?? 0) - (a?.x ?? 0), (still?.z ?? 0) - (a?.z ?? 0))).toBeLessThan(
      0.05,
    );

    // Its room and its job are for life.
    const elsewhere = rooms.operations.find((o) => o.operationId !== apolloId);
    if (elsewhere) {
      const grant = await owner.request.put(`/api/office-agents/${issues.id}/grants`, {
        data: { grants: [{ operationId: elsewhere.operationId, access: "view" }] },
        headers,
      });
      expect(grant.status()).toBe(400);
    }
    const job = await owner.request.patch(`/api/office-agents/${issues.id}`, {
      data: { role: "assistant" },
      headers,
    });
    expect([job.status(), ((await job.json()) as { error: string }).error]).toEqual([
      400,
      "kiosk_job_fixed",
    ]);

    // The member's GitHub access does not cover Apollo: for them there are no such agents.
    const theirs = (await (await member.request.get("/api/operations")).json()) as {
      operations: Array<{ name: string }>;
    };
    if (!theirs.operations.some((o) => o.name === "Apollo")) {
      const list = (await (await member.request.get("/api/office-agents")).json()) as {
        agents: Array<{ id: string; name: string }>;
      };
      for (const helper of made) {
        expect(list.agents.map((x) => x.id)).not.toContain(helper.id);
        expect(JSON.stringify(list)).not.toContain(helper.name);
        expect(await bodyOf(member, helper.id)).toBeNull();
        for (const path of ["brief", "conversation", "soul"]) {
          const res = await member.request.get(`/api/office-agents/${helper.id}/${path}`);
          expect(res.status(), path).toBe(404);
        }
        const said = await member.request.post(`/api/office-agents/${helper.id}/messages`, {
          data: { text: "What is on the board?" },
          headers,
        });
        expect(said.status()).toBe(404);
      }
    }

    await goToLobbyLevel(owner);
    await walkToLobby(owner);
    await waitStill(owner);
  } finally {
    await owner.bringToFront();
    await owner.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await owner.locator("canvas").first().hover();
    for (; turned > 0; turned--) {
      await owner.keyboard.press("c");
      await cameraSettled(owner);
    }
    await wheelZoomTo(owner, view.wantZoom);
    for (const helper of made) {
      await owner.request.delete(`/api/office-agents/${helper.id}`, { headers });
    }
    seed("remove");
  }
  for (const helper of made) {
    await expect.poll(() => bodyOf(owner, helper.id), { timeout: 15_000 }).toBeNull();
  }
}
