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

/**
 * The office page with the scene probe enabled, drawn with the low graphics preset. That is
 * the preset a software-rendered page (CI, the default here) picks by itself; asking for it
 * keeps what the steps expect of it (a waiting henchman's still arms, the lift's fade) the
 * same when the browsers draw on a GPU (`E2E_WEBGL=hardware`, #299).
 */
export const OFFICE_PROBE_PATH = "/office?stats&quality=low";

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

/** Name of the camera the scene renders with (`fpv-camera` in first person). */
export function cameraName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const r3f = (window as unknown as { __regulusR3F?: { get(): { camera: { name: string } } } })
      .__regulusR3F;
    return r3f ? r3f.get().camera.name : null;
  });
}

/** Where the scene's camera is, metres. */
export function cameraPosition(page: Page): Promise<{ x: number; y: number; z: number } | null> {
  return page.evaluate(() => {
    const r3f = (
      window as unknown as {
        __regulusR3F?: { get(): { camera: { position: { x: number; y: number; z: number } } } };
      }
    ).__regulusR3F;
    const p = r3f?.get().camera.position;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  });
}

/** Wait until the scene exists and our own avatar has spawned. */
export async function waitForScene(page: Page): Promise<void> {
  await expect
    .poll(async () => Object.keys(await humans(page)), { timeout: 90_000 })
    .toContain("local-human");
}

export const distance = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Viewport point of the free-desk click target nearest the middle of the
 * canvas (scene/henchmen `desk-hotspot-<seatId>` meshes), or null. `skip`
 * leaves out seats known to be taken.
 */
export function freeDeskPoint(
  page: Page,
  skip: readonly string[] = [],
): Promise<{ x: number; y: number; seatId: string } | null> {
  return page.evaluate((skipped) => {
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
      if (skipped.includes(o.name.slice("desk-hotspot-".length))) return;
      const p = o.getWorldPosition(o.position.clone()).project(camera);
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      const d = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
      if (!best || d < best.d) best = { x, y, seatId: o.name.slice("desk-hotspot-".length), d };
    });
    const found = best as { x: number; y: number; seatId: string } | null;
    return found ? { x: found.x, y: found.y, seatId: found.seatId } : null;
  }, skip);
}

export interface LocalPose extends Pos {
  /** `rotation.y` of the `local-human` group: the heading sent in `move`. */
  heading: number;
}

/** Our own avatar's drawn pose, or null before it spawned. */
export function localPose(page: Page): Promise<LocalPose | null> {
  return page.evaluate(() => {
    type Obj = { name: string; position: { x: number; z: number }; rotation: { y: number } };
    const r3f = (
      window as unknown as {
        __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
      }
    ).__regulusR3F;
    const o = r3f?.scene.getObjectByName("local-human");
    return o ? { x: o.position.x, z: o.position.z, heading: o.rotation.y } : null;
  });
}

/**
 * Our own avatar's pose at every frame the page draws, from now until its walk is over: it
 * has set off (the nav probe says walking) and stands again. How long that takes on the
 * clock does not matter, nor how few frames a slow page draws in a second: one frame walks
 * at most a tenth of a second's worth, however long it took to draw, so a walk of a few
 * metres is always tens of frames (#299). Gives up after `giveUpMs` if the walk never ends.
 */
export function sampleLocalWalk(page: Page, giveUpMs = 60_000): Promise<LocalPose[]> {
  return page.evaluate(async (limit) => {
    type Obj = { position: { x: number; z: number }; rotation: { y: number } };
    const w = window as unknown as {
      __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
      __regulusNav?: { pose(): { walking: boolean } };
    };
    const out: { x: number; z: number; heading: number }[] = [];
    const end = performance.now() + limit;
    let walked = false;
    while (performance.now() < end) {
      const o = w.__regulusR3F?.scene.getObjectByName("local-human");
      if (o) out.push({ x: o.position.x, z: o.position.z, heading: o.rotation.y });
      if (w.__regulusNav?.pose().walking) walked = true;
      else if (walked) break;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return out;
  }, giveUpMs);
}

/** Viewport point where the floor point `p` (y = 0) is drawn. */
export function screenPointOf(page: Page, p: Pos): Promise<{ x: number; y: number } | null> {
  return page.evaluate((world) => {
    type V = {
      set(x: number, y: number, z: number): V;
      project(c: unknown): V;
      x: number;
      y: number;
    };
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          scene: { position: { clone(): V } };
          get(): { camera: unknown; gl: { domElement: HTMLCanvasElement } };
        };
      }
    ).__regulusR3F;
    if (!r3f) return null;
    const { camera, gl } = r3f.get();
    const rect = gl.domElement.getBoundingClientRect();
    const v = r3f.scene.position.clone().set(world.x, 0, world.z).project(camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }, p);
}

/** The floor point (y = 0) under viewport point `(x, y)`, by the scene camera's ray. */
export function groundUnder(page: Page, x: number, y: number): Promise<Pos | null> {
  return page.evaluate(
    ({ sx, sy }) => {
      type V = {
        set(x: number, y: number, z: number): V;
        unproject(c: unknown): V;
        x: number;
        y: number;
        z: number;
      };
      const r3f = (
        window as unknown as {
          __regulusR3F?: {
            scene: { position: { clone(): V } };
            get(): { camera: unknown; gl: { domElement: HTMLCanvasElement } };
          };
        }
      ).__regulusR3F;
      if (!r3f) return null;
      const { camera, gl } = r3f.get();
      const rect = gl.domElement.getBoundingClientRect();
      const nx = ((sx - rect.left) / rect.width) * 2 - 1;
      const ny = -((sy - rect.top) / rect.height) * 2 + 1;
      const near = r3f.scene.position.clone().set(nx, ny, -1).unproject(camera);
      const far = r3f.scene.position.clone().set(nx, ny, 1).unproject(camera);
      const dy = far.y - near.y;
      if (Math.abs(dy) < 1e-9) return null;
      const t = -near.y / dy;
      return { x: near.x + (far.x - near.x) * t, z: near.z + (far.z - near.z) * t };
    },
    { sx: x, sy: y },
  );
}

/** Heading (three.js `rotation.y`) that faces from `from` toward `to`, as the app computes it. */
export const headingToward = (from: Pos, to: Pos) =>
  Math.atan2(0 - (to.x - from.x), 0 - (to.z - from.z));

/** Unsigned smallest angle between two headings, radians. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Viewport point of a board's click target (scene/boards `board-hotspot-<anchorId>`), or null. */
export function boardPoint(page: Page, anchorId: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((name) => {
    type V = { x: number; y: number; z: number; clone(): V; project(c: unknown): V };
    type Obj = { getWorldPosition(v: V): V; position: V };
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          scene: { getObjectByName(n: string): Obj | undefined };
          get(): { camera: unknown; gl: { domElement: HTMLCanvasElement } };
        };
      }
    ).__regulusR3F;
    const o = r3f?.scene.getObjectByName(name);
    if (!r3f || !o) return null;
    const { camera, gl } = r3f.get();
    const rect = gl.domElement.getBoundingClientRect();
    const p = o.getWorldPosition(o.position.clone()).project(camera);
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }, `board-hotspot-${anchorId}`);
}

/** Names of the carried-card objects the scene draws (`carried-card-<sessionId>`). */
export function carriedCardsInScene(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type Obj = { name: string; visible: boolean };
    const r3f = (
      window as unknown as { __regulusR3F?: { scene: { traverse(f: (o: Obj) => void): void } } }
    ).__regulusR3F;
    const out: string[] = [];
    r3f?.scene.traverse((o) => {
      if (o.name.startsWith("carried-card-") && o.visible) out.push(o.name);
    });
    return out;
  });
}

/** The page side of `recordToasts`. */
interface ToastLog {
  __e2eToasts?: { seen: string[]; observer: MutationObserver };
}

/**
 * From now on, note the text of every toast the page shows, however briefly (#248). A success
 * toast is up for 4 s, so a check that looks only after seconds of other work can miss one that
 * was shown. Toasts already up when this is called are not noted.
 */
export function recordToasts(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as ToastLog;
    w.__e2eToasts?.observer.disconnect();
    const known = new Set<string>();
    const seen: string[] = [];
    const scan = (note: boolean) => {
      for (const el of document.querySelectorAll<HTMLElement>(".rg-toast")) {
        const id = el.dataset.toastId ?? el.textContent ?? "";
        if (known.has(id)) continue;
        known.add(id);
        if (note) seen.push(el.textContent ?? "");
      }
    };
    scan(false);
    const observer = new MutationObserver(() => scan(true));
    observer.observe(document.body, { childList: true, subtree: true });
    w.__e2eToasts = { seen, observer };
  });
}

/** Texts (title and message run together) of the toasts shown since `recordToasts`. */
export function toastsSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as unknown as ToastLog).__e2eToasts?.seen ?? [])]);
}
