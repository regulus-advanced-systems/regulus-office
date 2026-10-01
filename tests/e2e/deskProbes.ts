/**
 * Read-only probe for clicking a henchman's laptop (#164, #199), through `window.__regulusR3F`
 * (the page must be opened with `?stats`, see probes.ts): a screen point where the laptop is
 * the nearest clickable object, found with the same raycast the scene's pointer events use
 * (the seated henchman hides most of the laptop). Walking up to the desk goes by nav state
 * (compoundProbes.ts `walkUpToDesk`, #205).
 */
import type { Page } from "@playwright/test";

type V3 = {
  x: number;
  y: number;
  z: number;
  clone(): V3;
  set(x: number, y: number, z: number): V3;
  project(camera: unknown): V3;
};
type Obj = {
  name: string;
  parent: Obj | null;
  position: V3;
  getWorldPosition(v: V3): V3;
};

/**
 * A viewport point where a click reaches `laptop-<seatId>`: the nearest object the scene's
 * pointer events hit there belongs to the laptop, and no HTML covers the canvas. Null when the
 * laptop is hidden everywhere (e.g. behind its henchman).
 */
export function laptopClickPoint(
  page: Page,
  seatId: string,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((name) => {
    type Hit = { distance: number; object: Obj };
    type Ray = {
      setFromCamera(ndc: { x: number; y: number }, camera: unknown): void;
      intersectObject(o: Obj, recursive: boolean): Hit[];
    };
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          scene: { getObjectByName(n: string): Obj | undefined };
          get(): {
            camera: unknown;
            gl: { domElement: HTMLCanvasElement };
            raycaster: Ray;
            internal: { interaction: Obj[] };
          };
        };
      }
    ).__regulusR3F;
    const laptop = r3f?.scene.getObjectByName(name);
    if (!r3f || !laptop) return null;
    const { camera, gl, raycaster, internal } = r3f.get();
    // A raycaster of our own: the scene's is left as its pointer events set it.
    const ray = new (raycaster.constructor as new () => Ray)();
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    const centre = laptop.getWorldPosition(laptop.position.clone()).project(camera);
    const cx = rect.left + ((centre.x + 1) / 2) * rect.width;
    const cy = rect.top + ((1 - centre.y) / 2) * rect.height;
    const isLaptop = (o: Obj | null): boolean => {
      for (let p = o; p; p = p.parent) if (p === laptop) return true;
      return false;
    };
    // Nearest points first, in a spiral of 2 px steps around the laptop's origin.
    const candidates: { x: number; y: number; d: number }[] = [];
    for (let dx = -40; dx <= 40; dx += 2) {
      for (let dy = -40; dy <= 40; dy += 2)
        candidates.push({ x: cx + dx, y: cy + dy, d: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const { x, y } of candidates) {
      if (document.elementFromPoint(x, y) !== canvas) continue;
      ray.setFromCamera(
        { x: ((x - rect.left) / rect.width) * 2 - 1, y: -((y - rect.top) / rect.height) * 2 + 1 },
        camera,
      );
      // The same hit test as the scene's pointer events: every interactive object, nearest hit.
      const hits = internal.interaction.flatMap((o) => ray.intersectObject(o, true));
      hits.sort((a, b) => a.distance - b.distance);
      if (hits.length > 0 && isLaptop(hits[0]?.object ?? null)) return { x, y };
    }
    return null;
  }, `laptop-${seatId}`);
}
