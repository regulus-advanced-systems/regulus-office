/**
 * The merge gong in the office e2e (#43): with a (fake) org token connected, a PR merged from
 * the PR board rings the gong once: the disc swings, confetti flies and is gone within 3 s,
 * any robot on the floor cheers and ends exactly where it sat. Then a manual bang by click
 * rings it, `E` at the gong rings it again once the ring is over, and a second bang at once is
 * refused (rate limit).
 */
import { expect, type Page } from "@playwright/test";
import { scenePoint } from "./agentProbes.ts";
import { clickInScene, navPose, walkInto } from "./compoundProbes.ts";
import { startFakeGitHub } from "./fakeGitHub.ts";
import {
  boneDriftDeg,
  boneSnapshot,
  gongStrikes,
  poseDrift,
  robotPoses,
  sampleGong,
} from "./gongProbes.ts";

const GONG = "gong-hotspot-gong";

export async function checkMergeGong(page: Page, opts: { githubPort: number; floor: string }) {
  const orgToken = "github_pat_E2Egong_0123456789abcdefghijk";
  const pull = {
    number: 12,
    title: "Hang the gong",
    state: "open",
    labels: [],
    assignees: [],
    user: { login: "olga" },
    html_url: "https://github.com/octo/hello/pull/12",
    body: "Bong.",
    updated_at: new Date().toISOString(),
    draft: false,
    merged_at: null,
    requested_reviewers: [],
    requested_teams: [],
    head: { ref: "office/gong", sha: "e2e12" },
    base: { ref: "trunk" },
  };
  const gh = await startFakeGitHub(
    { orgToken, repos: [{ owner: "octo", name: "hello", defaultBranch: "trunk" }] },
    { port: opts.githubPort, boards: { "octo/hello": { issues: [], pulls: [pull] } } },
  );
  const origin = new URL(page.url()).origin;
  try {
    await page.bringToFront();
    const connect = await page.request.put("/api/github/pat", {
      data: { token: orgToken },
      headers: { origin },
    });
    expect(connect.status()).toBe(200);
    await walkInto(page, opts.floor);
    await expect.poll(() => scenePoint(page, GONG)).not.toBeNull();
    const strikes = await gongStrikes(page);
    const ringBefore = (await sampleGong(page, 0)).swing.ringId;
    const seated = await robotPoses(page);

    // Merge from the PR board: the office rings at once, without waiting for a poll.
    const panel = page.getByRole("dialog", { name: "PR board" });
    await clickInScene(page, "board-hotspot-pr-board", panel);
    const card = panel.getByRole("button", { name: `#12 ${pull.title}` });
    await expect(card).toBeVisible({ timeout: 45_000 });
    await card.click();
    await panel.getByRole("button", { name: "Merge…" }).click();
    await panel.getByRole("button", { name: "Confirm merge" }).click();
    const ringing = await sampleGong(page, 2_500);
    await expect(
      page.locator(".rg-toast", { hasText: "Pull request merged" }).filter({ hasText: "#12" }),
    ).toBeVisible();
    expect(ringing.strikes, JSON.stringify(ringing)).toBe(strikes + 1);
    // The disc swings: a new ring whose swing animation reaches a real angle, and that the page
    // drew off centre. Read from the gong's own record, not from frames sampled at 1-3 fps.
    expect(ringing.swing.ringId, JSON.stringify(ringing)).toBeGreaterThan(ringBefore);
    expect(ringing.swing.peak, JSON.stringify(ringing)).toBeGreaterThan(0.05);
    expect(ringing.swing.frames, JSON.stringify(ringing)).toBeGreaterThan(0);
    expect(ringing.maxConfetti, JSON.stringify(ringing)).toBeGreaterThan(0);
    for (const [id, pose] of Object.entries(seated))
      if (pose.seated) expect(ringing.cheered, `robot ${id} cheers`).toContain(id);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel).toHaveCount(0);

    // Over within 3 s (plus the crossfade): still disc, no confetti, robots back as they were.
    await page.waitForTimeout(1_500);
    const after = await sampleGong(page, 300);
    expect(after.lastSwing, JSON.stringify(after)).toBe(0);
    expect(after.lastConfetti, JSON.stringify(after)).toBe(0);
    expect(after.strikes).toBe(strikes + 1);
    for (const [id, pose] of Object.entries(after.robots)) {
      expect(pose.cheering, `robot ${id} stopped cheering`).toBe(false);
      expect(pose.animation, `robot ${id} animation`).toBe(seated[id]?.animation);
    }
    expect(poseDrift(seated, after.robots)).toBeLessThan(1e-6);

    // A bang by click rings it, and walks us over to the gong. The camera follows the walk, so
    // the gong's screen point moves: a second click at the same point lands on the wall or the
    // floor on a slow runner (#229). The refused bang below is pressed with `E` instead.
    const gong = await scenePoint(page, GONG);
    if (!gong) throw new Error("gong not in view");
    await page.mouse.click(gong.x, gong.y);
    await expect.poll(() => gongStrikes(page)).toBe(strikes + 2);
    await expect.poll(async () => (await navPose(page)).walking, { timeout: 30_000 }).toBe(false);

    // Once the ring is over, `E` at the gong bangs it too. A press that sends nothing (not in
    // reach yet) is pressed again; a bang shows up within the inner wait, so no press repeats
    // one that was sent.
    await page.waitForTimeout(4_200);
    await expect(async () => {
      await page.keyboard.press("e");
      await expect.poll(() => gongStrikes(page), { timeout: 5_000 }).toBe(strikes + 3);
    }).toPass({ timeout: 30_000 });

    // Another bang straight away is refused (the floor's cooldown) and spends nothing.
    const refused = page.locator(".rg-toast", { hasText: "The gong is still ringing." });
    await expect(refused).toHaveCount(0);
    await page.keyboard.press("e");
    await expect(refused).toBeVisible();
    expect(await gongStrikes(page)).toBe(strikes + 3);
  } finally {
    await page.request
      .delete("/api/github/connection", { headers: { origin } })
      .catch(() => undefined);
    await gh.close();
  }
}

/**
 * The agents e2e (#43): a real robot at its desk. A bang on the gong makes it cheer in its chair
 * (its bones move a lot), then it sits back: the same placement, the same animation and every
 * bone exactly where it was, and still again afterwards (#159).
 */
export async function checkRobotCheers(page: Page, agentId: string) {
  await page.bringToFront();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => scenePoint(page, GONG)).not.toBeNull();
  const before = await robotPoses(page);
  expect(before[agentId]?.seated, JSON.stringify(before)).toBe(true);
  const bones = await boneSnapshot(page, agentId);
  const strikes = await gongStrikes(page);

  const gong = await scenePoint(page, GONG);
  if (!gong) throw new Error("gong not in view");
  await page.mouse.click(gong.x, gong.y);
  const ringing = await sampleGong(page, 1_200);
  expect(ringing.strikes).toBe(strikes + 1);
  expect(ringing.cheered, JSON.stringify(ringing)).toContain(agentId);
  expect(boneDriftDeg(bones, await boneSnapshot(page, agentId))).toBeGreaterThan(10);

  // About 3 s after the ring, plus the crossfade back.
  await page.waitForTimeout(2_600);
  const after = await sampleGong(page, 300);
  const pose = after.robots[agentId];
  expect(pose?.cheering, JSON.stringify(after)).toBe(false);
  expect(pose?.animation).toBe(before[agentId]?.animation);
  expect(pose?.seated).toBe(true);
  expect(poseDrift(before, after.robots)).toBeLessThan(1e-6);
  if (pose?.animation === "sit_idle") {
    expect(boneDriftDeg(bones, await boneSnapshot(page, agentId))).toBeLessThan(0.1);
    await page.waitForTimeout(1_000);
    expect(boneDriftDeg(bones, await boneSnapshot(page, agentId))).toBeLessThan(0.1);
  }
}
