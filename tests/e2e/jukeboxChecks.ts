/**
 * The lobby jukebox in the office e2e (#47): both humans walk up to the
 * jukebox; the owner opens it with `E`, queues a bundled track by keyboard;
 * the member's browser shows the same track, and both browsers' players
 * run at the same playhead within a tolerance, measured at one instant on
 * the shared machine clock (both pages run on this machine, so `Date.now()`
 * is the same clock in both). The measured spread is reported.
 *
 * Reads `window.__regulusJukebox` (apps/web/src/audio/jukebox/
 * useJukeboxPlayback.ts, published with `?stats`).
 */
import { expect, type Page, test } from "@playwright/test";
import { navPose, waitStill, walkTo } from "./compoundProbes.ts";

/** Two browsers' players may differ by at most this much (ms) on a loaded CI machine. */
export const PLAYHEAD_TOLERANCE_MS = 150;

/** The page side of `window.__regulusJukebox` this check reads. */
interface ProbeWindow {
  __regulusJukebox?: {
    sync: { trackId: string; driftMs: number; offsetMs: number; action: string } | null;
    elementMs(): number | null;
    playing(): boolean;
    level(): number;
    stand(): { x: number; z: number } | null;
  };
}

interface Reading {
  /** `Date.now()` when read. */
  wall: number;
  /** Element position, ms. */
  el: number | null;
  playing: boolean;
  trackId: string;
  driftMs: number | null;
  offsetMs: number | null;
  action: string | null;
  level: number;
}

export const read = (page: Page): Promise<Reading> =>
  page.evaluate(() => {
    const j = (window as unknown as ProbeWindow).__regulusJukebox;
    if (!j) throw new Error("no __regulusJukebox (open the page with ?stats)");
    return {
      wall: Date.now(),
      el: j.elementMs(),
      playing: j.playing(),
      trackId: j.sync?.trackId ?? "",
      driftMs: j.sync?.driftMs ?? null,
      offsetMs: j.sync?.offsetMs ?? null,
      action: j.sync?.action ?? null,
      level: j.level(),
    };
  });

const standOf = async (page: Page) => {
  const stand = await page.evaluate(
    () => (window as unknown as ProbeWindow).__regulusJukebox?.stand() ?? null,
  );
  if (!stand) throw new Error("no jukebox in this compound");
  return stand;
};

export async function walkUpToJukebox(page: Page): Promise<void> {
  const stand = await standOf(page);
  await expect(async () => {
    const pose = await navPose(page);
    if (!pose.walking && Math.hypot(pose.x - stand.x, pose.z - stand.z) <= 0.8) return;
    if (!pose.walking) expect(await walkTo(page, stand.x, stand.z)).toBe(true);
    throw new Error("walking to the jukebox");
  }).toPass({ timeout: 90_000, intervals: [500, 1_000] });
  await waitStill(page);
}

/** The two players' positions at one instant: each extrapolated to the later read. */
async function spread(a: Page, b: Page): Promise<{ ms: number; ra: Reading; rb: Reading }> {
  const [ra, rb] = await Promise.all([read(a), read(b)]);
  if (ra.el === null || rb.el === null) throw new Error("no audio element");
  const t = Math.max(ra.wall, rb.wall);
  const pa = ra.el + (ra.playing ? t - ra.wall : 0);
  const pb = rb.el + (rb.playing ? t - rb.wall : 0);
  return { ms: pa - pb, ra, rb };
}

export async function checkJukebox(owner: Page, member: Page): Promise<void> {
  await Promise.all([walkUpToJukebox(owner), walkUpToJukebox(member)]);

  // E at the jukebox opens its panel (SPEC §9.2); the queue is operable by keyboard.
  await owner.bringToFront();
  await owner.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await owner.keyboard.press("e");
  const panel = owner.getByTestId("jukebox-panel");
  await expect(panel).toBeVisible();
  const queue = owner.getByRole("button", { name: "Queue “Spy Glass”" });
  await queue.focus();
  await owner.keyboard.press("Enter");
  await expect(owner.getByTestId("jukebox-now-title")).toHaveText("Spy Glass");

  // The member's browser shows the same track (shared BuildingRoom state).
  await expect(member.getByTestId("jukebox-strip")).toContainText("Spy Glass");

  // Both players run, in the lobby, loud: right in front of the jukebox.
  for (const page of [owner, member]) {
    await expect
      .poll(
        async () => {
          const r = await read(page);
          return r.playing && r.trackId === "bundled:spy-glass" && r.action !== "seek";
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    expect((await read(page)).level).toBeGreaterThan(0.9);
  }

  // Same playhead within tolerance: let the nudging settle, then sample a few seconds.
  await owner.waitForTimeout(3_000);
  const samples: number[] = [];
  const drifts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const s = await spread(owner, member);
    samples.push(s.ms);
    for (const r of [s.ra, s.rb]) if (r.driftMs !== null) drifts.push(r.driftMs);
    await owner.waitForTimeout(400);
  }
  const worst = Math.max(...samples.map(Math.abs));
  const worstDrift = Math.max(...drifts.map(Math.abs));
  const median = [...samples].sort((x, y) => x - y)[Math.floor(samples.length / 2)] ?? 0;
  test.info().annotations.push({
    type: "jukebox sync",
    description:
      `between browsers: median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms over ` +
      `${samples.length} samples; each player vs the server playhead: worst ${worstDrift.toFixed(1)} ms`,
  });
  console.log(
    `[jukebox] between browsers median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms; ` +
      `player vs server worst ${worstDrift.toFixed(1)} ms; samples ${samples.map((x) => x.toFixed(0)).join(", ")}`,
  );
  expect(worst).toBeLessThan(PLAYHEAD_TOLERANCE_MS);

  // The owner queued it: the owner may stop it; the jukebox falls quiet for both.
  await owner.getByRole("button", { name: "Skip" }).click();
  await expect(member.getByTestId("jukebox-strip")).toContainText("quiet");
  await owner.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}
