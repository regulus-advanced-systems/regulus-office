/**
 * Read-only probes into the running office page. The scene is inspected
 * through `window.__regulusR3F`, which the app publishes when the page is
 * opened with `?stats` (apps/web/src/scene/perf/stats.ts); humans are the
 * groups named `local-human` and `human-<sessionId>` in the avatar layer.
 */
import { expect, type Page } from "@playwright/test";

export interface Pos {
  x: number;
  z: number;
}

/** The office page with the scene probe enabled. */
export const OFFICE_PROBE_PATH = "/office?stats";

/** Positions of every human group in the scene, keyed by object name. */
export function humans(page: Page): Promise<Record<string, Pos>> {
  return page.evaluate(() => {
    type Obj = { name: string; position: { x: number; z: number } };
    const r3f = (
      window as unknown as { __regulusR3F?: { scene: { traverse(f: (o: Obj) => void): void } } }
    ).__regulusR3F;
    const out: Record<string, { x: number; z: number }> = {};
    r3f?.scene.traverse((o) => {
      if (o.name === "local-human" || o.name.startsWith("human-"))
        out[o.name] = { x: o.position.x, z: o.position.z };
    });
    return out;
  });
}

/** Names of the other humans' avatars (`human-<sessionId>`) this page draws. */
export async function remoteHumans(page: Page): Promise<string[]> {
  return Object.keys(await humans(page)).filter((n) => n.startsWith("human-"));
}

/** Three.js type of the camera the scene currently renders with. */
export function cameraType(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const r3f = (window as unknown as { __regulusR3F?: { get(): { camera: { type: string } } } })
      .__regulusR3F;
    return r3f ? r3f.get().camera.type : null;
  });
}

/** Wait until the scene exists and our own avatar has spawned. */
export async function waitForScene(page: Page): Promise<void> {
  await expect
    .poll(async () => Object.keys(await humans(page)), { timeout: 30_000 })
    .toContain("local-human");
}

export const distance = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z);
