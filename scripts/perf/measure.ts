/**
 * Compound performance measurement (#190, SPEC §11): drives a production
 * build of the office harness (apps/web/dev/office.html, 12 rooms, 20
 * henchmen working in the Dev room, 3 nearby rooms with 4 each, 4 humans)
 * in Chromium and prints frame-time percentiles, main-thread time, draw
 * calls, triangles and texture memory per view and per profile.
 *
 * Profiles (no iGPU on the measuring machine; see docs/walkthrough/m25.md):
 * - `gpu`: the machine's GPU at 1920×1080, vsync on (what a user sees).
 * - `uncapped`: the same with vsync and the frame limiter off (headroom).
 * - `igpu`: an iGPU proxy: 3840×2160 (4× the pixels of 1080p, so per-pixel
 *   work weighs like 1080p on a GPU with a quarter the throughput) and
 *   Chrome's CPU throttling ×4 on the main thread, vsync on.
 * - `igpu-uncapped`: the same with vsync and the frame limiter off (headroom;
 *   its p99 also catches GPU-process flow-control stalls that vsync hides).
 * - `software`: SwiftShader at 1280×800 (CI's tier), all cores.
 *
 * Usage: build the harness, then run this script from the repo root:
 *   (cd apps/web && PERF_OUT_DIR=/tmp/rg-perf-harness bunx vite build --config vite.harness.config.ts)
 *   bun scripts/perf/measure.ts [--dir /tmp/rg-perf-harness] [--port 5791]
 *     [--profiles gpu,uncapped,igpu,igpu-uncapped,software]
 *     [--views room,room30,overview,close,beach,lobby,landing,closed]
 *     [--quality auto|low|medium|high] [--seconds 6] [--json out.json]
 *     [--agents 10]   office agents walking the Dev room as well (#252)
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const dir = arg("dir", "/tmp/rg-perf-harness");
const port = Number(arg("port", "5791"));
const profiles = arg("profiles", "gpu,uncapped,igpu,igpu-uncapped,software").split(",");
const views = arg("views", "room,overview,close,beach").split(",");
const quality = arg("quality", "auto");
const seconds = Number(arg("seconds", "6"));
const jsonOut = arg("json", "");

const agents = Number(arg("agents", "0"));
const BASE = `n=20&mode=working&rooms=12&humans=4&nearby=3&skins=mixed&stats${
  agents > 0 ? `&agents=${agents}` : ""
}`;
const VIEW: Record<string, string> = {
  room: "",
  // The Dev room 30 m out (the #190 default framing), for builds with another default.
  room30: "&zoom=0.527",
  overview: "&zoom=1",
  close: "&zoom=0",
  beach: "&at=beach&door=open",
  // Levels (#269): the lobby by the lift, a level's lift landing, and a level with closed rooms.
  lobby: "&level=lobby&at=lift",
  landing: "&level=regulus&at=lift",
  closed: "&level=ante&at=door:vault",
};

interface Profile {
  args: string[];
  width: number;
  height: number;
  cpuRate: number;
}

const GPU = ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist"];
const UNCAPPED = ["--disable-gpu-vsync", "--disable-frame-rate-limit"];
const PROFILES: Record<string, Profile> = {
  gpu: { args: GPU, width: 1920, height: 1080, cpuRate: 1 },
  uncapped: { args: [...GPU, ...UNCAPPED], width: 1920, height: 1080, cpuRate: 1 },
  igpu: { args: GPU, width: 3840, height: 2160, cpuRate: 4 },
  "igpu-uncapped": { args: [...GPU, ...UNCAPPED], width: 3840, height: 2160, cpuRate: 4 },
  software: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    width: 1280,
    height: 800,
    cpuRate: 1,
  },
};

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

if (!existsSync(join(dir, "dev/office.html"))) {
  console.error(`no harness build in ${dir}; build it first (see the header)`);
  process.exit(1);
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    const file = Bun.file(join(dir, path));
    return file.size
      ? new Response(file, {
          headers: { "content-type": TYPES[extname(path)] ?? "application/octet-stream" },
        })
      : new Response("not found", { status: 404 });
  },
});

type Row = Record<string, string | number>;
const rows: Row[] = [];

for (const name of profiles) {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`unknown profile ${name}`);
  const browser = await chromium.launch({ headless: true, args: profile.args });
  for (const view of views) {
    const page = await browser.newPage({
      viewport: { width: profile.width, height: profile.height },
    });
    if (profile.cpuRate > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
    }
    const q = quality === "auto" ? "" : `&quality=${quality}`;
    await page.goto(`http://127.0.0.1:${port}/dev/office.html?${BASE}${VIEW[view] ?? ""}${q}`);
    await page.waitForFunction(() => Boolean(window.__regulusPerf), null, { timeout: 120_000 });
    // Let models load, shaders compile and the camera settle before the window opens.
    await page.waitForTimeout(name === "software" ? 8000 : 5000);
    await page.evaluate(() => window.__regulusPerf?.reset());
    await page.waitForTimeout(seconds * 1000);
    const s = await page.evaluate(() => window.__regulusPerf?.sample());
    await page.close();
    if (!s) continue;
    const row: Row = {
      profile: name,
      view,
      quality: s.quality,
      fps: s.fps,
      p50: s.p50,
      p90: s.p90,
      p99: s.p99,
      cpuP50: s.cpuP50,
      cpuP90: s.cpuP90,
      calls: s.drawCalls,
      tris: Math.round(s.triangles / 1000),
      texMB: s.textureMB,
      size: `${s.width}x${s.height}`,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  await browser.close();
}
server.stop(true);

console.log(
  "\n| profile | view | tier | fps | p50 ms | p90 ms | p99 ms | main p50/p90 ms | draws | tris (k) | tex MB |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows)
  console.log(
    `| ${r.profile} | ${r.view} | ${r.quality} | ${r.fps} | ${r.p50} | ${r.p90} | ${r.p99} | ${r.cpuP50} / ${r.cpuP90} | ${r.calls} | ${r.tris} | ${r.texMB} |`,
  );
if (jsonOut) await writeFile(jsonOut, JSON.stringify(rows, null, 2));
