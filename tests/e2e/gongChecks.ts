/**
 * The merge gong in the office e2e (#43): with a (fake) org token connected, a PR merged from
 * the PR board rings the gong once: the disc swings, confetti flies and is gone within 3 s,
 * any henchman on the operation cheers and ends exactly where it sat. Then a manual bang by click
 * rings it, `E` at the gong rings it again once the ring is over, and a second bang at once is
 * refused (rate limit).
 */
import { expect, type Page, test } from "@playwright/test";
import { scenePoint } from "./agentProbes.ts";
import { clickInScene, navPose, walkInto } from "./compoundProbes.ts";
import { loadBoards } from "./githubAccess.ts";
import {
  boneDriftDeg,
  boneSnapshot,
  gongStrikes,
  henchmanPoses,
  poseDrift,
  sampleGong,
} from "./gongProbes.ts";
import { recordToasts, toastsSeen } from "./probes.ts";

const GONG = "gong-hotspot-gong";

export async function checkMergeGong(page: Page, opts: { operation: string }) {
  const orgToken = "github_pat_E2Egong_0123456789abcdefghijk";
  // The office rings once per merge (celebrations/merges.ts): a repeated run (`--repeat-each`)
  // merges another PR.
  const number = 12 + test.info().repeatEachIndex;
  const pull = {
    number,
    title: "Hang the gong",
    state: "open",
    labels: [],
    assignees: [],
    user: { login: "olga" },
    html_url: `https://github.com/octo/hello/pull/${number}`,
    body: "Bong.",
    updated_at: new Date().toISOString(),
    draft: false,
    merged_at: null,
    requested_reviewers: [],
    requested_teams: [],
    head: { ref: "office/gong", sha: `e2e${number}` },
    base: { ref: "trunk" },
  };
  // The fake GitHub runs beside the office (#270); this step loads its org and board into it.
  const gh = await loadBoards(
    { orgToken, repos: [{ owner: "octo", name: "hello", defaultBranch: "trunk" }] },
    { "octo/hello": { issues: [], pulls: [pull] } },
  );
  const origin = new URL(page.url()).origin;
  try {
    await page.bringToFront();
    const connect = await page.request.put("/api/github/pat", {
      data: { token: orgToken },
      headers: { origin },
    });
    expect(connect.status()).toBe(200);
    await walkInto(page, opts.operation);
    await expect.poll(() => scenePoint(page, GONG)).not.toBeNull();
    const strikes = await gongStrikes(page);
    const ringBefore = (await sampleGong(page, 0)).swing.ringId;
    const seated = await henchmanPoses(page);

    // Merge from the PR board: the office rings at once, without waiting for a poll.
    const panel = page.getByRole("dialog", { name: "PR board" });
    await clickInScene(page, "board-hotspot-pr-board", panel);
    const card = panel.getByRole("button", { name: `#${number} ${pull.title}` });
    await expect(card).toBeVisible({ timeout: 45_000 });
    await card.click();
    await panel.getByRole("button", { name: "Merge…" }).click();
    // The toast comes with the ring (the same `pr.merged` message) and is up for 4 s, while the
    // sample below runs 2.5 s from when the scene has drawn the ring, at a few frames a second
    // on a loaded runner: often longer than 4 s from the toast (#248). Note it as it shows.
    await recordToasts(page);
    await panel.getByRole("button", { name: "Confirm merge" }).click();
    // Sample from when the ring arrives: the merge goes through the server and (fake) GitHub
    // first, which takes seconds on a loaded runner.
    const ringing = await sampleGong(page, 2_500, { afterStrikes: strikes, waitMs: 30_000 });
    await expect
      .poll(() => toastsSeen(page))
      .toContainEqual(expect.stringContaining(`Pull request merged#${number} ${pull.title}`));
    expect(ringing.strikes, JSON.stringify(ringing)).toBe(strikes + 1);
    // The disc swings: a new ring whose swing animation reaches a real angle, and that the page
    // drew off centre. Read from the gong's own record, not from frames sampled at 1-3 fps.
    expect(ringing.swing.ringId, JSON.stringify(ringing)).toBeGreaterThan(ringBefore);
    expect(ringing.swing.peak, JSON.stringify(ringing)).toBeGreaterThan(0.05);
    expect(ringing.swing.frames, JSON.stringify(ringing)).toBeGreaterThan(0);
    expect(ringing.maxConfetti, JSON.stringify(ringing)).toBeGreaterThan(0);
    for (const [id, pose] of Object.entries(seated))
      if (pose.seated) expect(ringing.cheered, `henchman ${id} cheers`).toContain(id);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel).toHaveCount(0);

    // Over within 3 s (plus the crossfade): still disc, no confetti, henchmen back as they were.
    await page.waitForTimeout(1_500);
    const after = await sampleGong(page, 300);
    expect(after.lastSwing, JSON.stringify(after)).toBe(0);
    expect(after.lastConfetti, JSON.stringify(after)).toBe(0);
    expect(after.strikes).toBe(strikes + 1);
    for (const [id, pose] of Object.entries(after.henchmen)) {
      expect(pose.cheering, `henchman ${id} stopped cheering`).toBe(false);
      expect(pose.animation, `henchman ${id} animation`).toBe(seated[id]?.animation);
    }
    expect(poseDrift(seated, after.henchmen)).toBeLessThan(1e-6);

    // A bang by click rings it, and walks us over to the gong. The camera follows the walk, so
    // the gong's screen point moves: a second click at the same point lands on the wall or the
    // operation on a slow runner (#229). The refused bang below is pressed with `E` instead.
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

    // Another bang straight away is refused (the operation's cooldown) and spends nothing.
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
 * The agents e2e (#43): a real henchman at its desk. A bang on the gong makes it cheer in its chair
 * (its bones move a lot), then it sits back: the same placement, the same animation and every
 * bone exactly where it was, and still again afterwards (#159).
 */
export async function checkHenchmanCheers(page: Page, agentId: string) {
  await page.bringToFront();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => scenePoint(page, GONG)).not.toBeNull();
  const before = await henchmanPoses(page);
  expect(before[agentId]?.seated, JSON.stringify(before)).toBe(true);
  const bones = await boneSnapshot(page, agentId);
  const strikes = await gongStrikes(page);

  const gong = await scenePoint(page, GONG);
  if (!gong) throw new Error("gong not in view");
  await page.mouse.click(gong.x, gong.y);
  const ringing = await sampleGong(page, 1_200, { afterStrikes: strikes });
  expect(ringing.strikes).toBe(strikes + 1);
  expect(ringing.cheered, JSON.stringify(ringing)).toContain(agentId);
  expect(boneDriftDeg(bones, await boneSnapshot(page, agentId))).toBeGreaterThan(10);

  // About 3 s after the ring, plus the crossfade back.
  await page.waitForTimeout(2_600);
  const after = await sampleGong(page, 300);
  const pose = after.henchmen[agentId];
  expect(pose?.cheering, JSON.stringify(after)).toBe(false);
  expect(pose?.animation).toBe(before[agentId]?.animation);
  expect(pose?.seated).toBe(true);
  expect(poseDrift(before, after.henchmen)).toBeLessThan(1e-6);
  if (pose?.animation === "sit_idle") {
    expect(boneDriftDeg(bones, await boneSnapshot(page, agentId))).toBeLessThan(0.1);
    await page.waitForTimeout(1_000);
    expect(boneDriftDeg(bones, await boneSnapshot(page, agentId))).toBeLessThan(0.1);
  }
}
