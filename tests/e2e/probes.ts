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

/** Width x depth of the floor being walked (the walk plane follows the template). */
export function floorSize(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    type Obj = { name: string; geometry?: { parameters?: { width: number; height: number } } };
    const r3f = (
      window as unknown as { __regulusR3F?: { scene: { traverse(f: (o: Obj) => void): void } } }
    ).__regulusR3F;
    let size: string | null = null;
    r3f?.scene.traverse((o) => {
      const p = o.geometry?.parameters;
      if (o.name === "walk-plane" && p) size = `${p.width}x${p.height}`;
    });
    return size;
  });
}

export const distance = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Viewport point of the free-desk click target nearest the middle of the
 * canvas (scene/robots `desk-hotspot-<seatId>` meshes), or null.
 */
export function freeDeskPoint(
  page: Page,
): Promise<{ x: number; y: number; seatId: string } | null> {
  return page.evaluate(() => {
    type V = { x: number; y: number; z: number; clone(): V; project(c: unknown): V };
    type Obj = { name: string; getWorldPosition(v: V): V; position: V };
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          scene: { traverse(f: (o: Obj) => void): void };
          get(): { camera: unknown; gl: { domElement: HTMLCanvasElement } };
        };
      }
    ).__regulusR3F;
    if (!r3f) return null;
    const { camera, gl } = r3f.get();
    const rect = gl.domElement.getBoundingClientRect();
    let best: { x: number; y: number; seatId: string; d: number } | null = null;
    r3f.scene.traverse((o) => {
      if (!o.name.startsWith("desk-hotspot-")) return;
      const p = o.getWorldPosition(o.position.clone()).project(camera);
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      const d = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
      if (!best || d < best.d) best = { x, y, seatId: o.name.slice("desk-hotspot-".length), d };
    });
    const found = best as { x: number; y: number; seatId: string } | null;
    return found ? { x: found.x, y: found.y, seatId: found.seatId } : null;
  });
}
