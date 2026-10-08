/**
 * Read-only probes for office agents' bodies in the scene (#252; needs `?stats`, see probes.ts).
 * Each body is the group `office-agent-<id>` (apps/web/src/scene/officeAgents/OfficeAgentLayer.tsx),
 * whose `userData` carries what it shows.
 */
import type { Page } from "@playwright/test";

export interface SceneBody {
  name: string;
  caption: string;
  mode: string;
  appearance: string;
  own: boolean;
  canChat: boolean;
  hidden: boolean;
  moving: boolean;
  x: number;
  z: number;
  bubbleKind: string;
  bubbleText: string;
  /** Where its chest is on screen. */
  sx: number;
  sy: number;
}

/** A body as this page draws it, or null when it is not in the scene (or out of sight). */
export function bodyOf(page: Page, agentId: string): Promise<SceneBody | null> {
  return page.evaluate((id) => {
    type V = { x: number; y: number; z: number; clone(): V; project(c: unknown): V };
    type Obj = {
      visible: boolean;
      position: V;
      userData: Record<string, unknown>;
      getWorldPosition(v: V): V;
    };
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          scene: { getObjectByName(n: string): Obj | undefined };
          get(): { camera: unknown; gl: { domElement: HTMLCanvasElement } };
        };
      }
    ).__regulusR3F;
    const o = r3f?.scene.getObjectByName(`office-agent-${id}`);
    if (!r3f || !o || !o.visible) return null;
    const { camera, gl } = r3f.get();
    const rect = gl.domElement.getBoundingClientRect();
    const chest = o.getWorldPosition(o.position.clone());
    chest.y = 1.05;
    const p = chest.project(camera);
    return {
      ...(o.userData as unknown as Omit<SceneBody, "sx" | "sy">),
      sx: rect.left + ((p.x + 1) / 2) * rect.width,
      sy: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }, agentId);
}

/** Where a named scene object is in the world (metres), or null when it is not in the scene. */
export function sceneXZ(page: Page, name: string): Promise<{ x: number; z: number } | null> {
  return page.evaluate((n) => {
    type V = { x: number; z: number; clone(): V };
    type Obj = { position: V; getWorldPosition(v: V): V };
    const r3f = (
      window as unknown as {
        __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
      }
    ).__regulusR3F;
    const o = r3f?.scene.getObjectByName(n);
    if (!o) return null;
    const p = o.getWorldPosition(o.position.clone());
    return { x: p.x, z: p.z };
  }, name);
}

/** Where a visitor stands at the reception desk (#60), from the desk's hit target. */
export function receptionStand(page: Page): Promise<{ x: number; z: number } | null> {
  return page.evaluate(() => {
    type Obj = { userData: { standX?: number; standZ?: number } };
    const r3f = (
      window as unknown as {
        __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
      }
    ).__regulusR3F;
    const o = r3f?.scene.getObjectByName("reception-hotspot");
    return o && typeof o.userData.standX === "number" && typeof o.userData.standZ === "number"
      ? { x: o.userData.standX, z: o.userData.standZ }
      : null;
  });
}
