/**
 * The e2e perf probe (#190, SPEC §11): frame-time percentiles, main-thread
 * time, draw calls, triangles, texture memory and OperationRoom join times from
 * `window.__regulusPerf` (published with `?stats`, apps/web/src/scene/perf/PerfProbe.tsx).
 * Report only: CI renders in software (SwiftShader) on shared runners, so the
 * only operation is that the scene keeps drawing; the numbers go to the test's
 * attachments and the log, for trends.
 */
import { expect, type Page, test } from "@playwright/test";

export interface PerfReport {
  frames: number;
  fps: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  cpuP50: number;
  cpuP90: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  textureMB: number;
  quality: string;
  renderer: string;
  width: number;
  height: number;
  joins: { operationId: string; ms: number }[];
}

type PerfWindow = { __regulusPerf?: { reset(): void; sample(): PerfReport } };

/** A generous floor: some frames, and a median frame under 2 s (about 0.5 fps). */
export const PERF_OPERATION = { minFrames: 3, maxP50Ms: 2000 } as const;

/** Record `seconds` of frames on `page`, attach the report as `perf-<label>.json` and log it. */
export async function reportFramePerf(page: Page, label: string, seconds = 5): Promise<PerfReport> {
  await page.waitForFunction(() => Boolean((window as unknown as PerfWindow).__regulusPerf));
  await page.evaluate(() => (window as unknown as PerfWindow).__regulusPerf?.reset());
  await page.waitForTimeout(seconds * 1000);
  const report = await page.evaluate(() =>
    (window as unknown as PerfWindow).__regulusPerf?.sample(),
  );
  if (!report) throw new Error("no perf probe (open the page with ?stats)");
  const line =
    `perf ${label}: ${report.fps} fps, frame p50 ${report.p50} / p90 ${report.p90} / p99 ${report.p99} ms, ` +
    `main ${report.cpuP50} / ${report.cpuP90} ms, ${report.drawCalls} draws, ` +
    `${Math.round(report.triangles / 1000)}k tris, ${report.textureMB} MB textures, ` +
    `tier ${report.quality} (${report.renderer}), joins ${report.joins.map((j) => `${j.operationId} ${j.ms} ms`).join(", ") || "none"}`;
  console.log(line);
  await test.info().attach(`perf-${label}.json`, {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  expect(report.frames).toBeGreaterThanOrEqual(PERF_OPERATION.minFrames);
  expect(report.p50).toBeLessThan(PERF_OPERATION.maxP50Ms);
  return report;
}
