/**
 * Read-only probes for robots in the office scene (needs `?stats`, see probes.ts). Each robot
 * is the group `robot-<agentId>` (apps/web/src/scene/robots/Robot.tsx), whose `userData`
 * carries the RobotState it draws (status, action, handRaised, seatId) and the animation it
 * resolved from them (clip name, seated or not).
 */
import type { Page, WebSocket } from "@playwright/test";

export interface RobotProbe {
  agentId: string;
  status: string;
  action: string;
  handRaised: boolean;
  animation: string;
  seated: boolean;
  seatId: string;
}

/** Every robot the page draws, keyed by agent id. */
export function robots(page: Page): Promise<Record<string, RobotProbe>> {
  return page.evaluate(() => {
    type Obj = { name: string; userData: Record<string, unknown> };
    const r3f = (
      window as unknown as { __regulusR3F?: { scene: { traverse(f: (o: Obj) => void): void } } }
    ).__regulusR3F;
    const out: Record<string, RobotProbe> = {};
    r3f?.scene.traverse((o) => {
      if (!o.name.startsWith("robot-") || !("status" in o.userData)) return;
      const agentId = o.name.slice("robot-".length);
      out[agentId] = { agentId, ...(o.userData as Omit<RobotProbe, "agentId">) };
    });
    return out;
  });
}

/**
 * Starts sampling every robot's (status, action, animation, handRaised) inside the page every
 * 50 ms, so short-lived states are not missed between Playwright polls. Read with {@link history}.
 */
export async function recordRobots(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Obj = { name: string; userData: Record<string, unknown> };
    const w = window as unknown as {
      __regulusR3F?: { scene: { traverse(f: (o: Obj) => void): void } };
      __robotHistory?: string[];
      __robotTimer?: number;
    };
    w.__robotHistory = [];
    if (w.__robotTimer) clearInterval(w.__robotTimer);
    w.__robotTimer = window.setInterval(() => {
      w.__regulusR3F?.scene.traverse((o) => {
        if (!o.name.startsWith("robot-") || !("status" in o.userData)) return;
        const d = o.userData;
        const entry = `${d.status}/${d.action}/${d.animation}/${d.handRaised ? "hand" : "-"}`;
        const h = w.__robotHistory ?? [];
        if (h[h.length - 1] !== entry) h.push(entry);
      });
    }, 50);
  });
}

/** Distinct `status/action/animation/hand` samples since {@link recordRobots}, in order. */
export function history(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __robotHistory?: string[] }).__robotHistory ?? [],
  );
}

/** Viewport point of the named scene object's world position, or null. */
export function scenePoint(page: Page, name: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((target) => {
    type V = { x: number; y: number; z: number; clone(): V; project(c: unknown): V };
    type Obj = { name: string; getWorldPosition(v: V): V; position: V };
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          scene: { getObjectByName(n: string): Obj | undefined };
          get(): { camera: unknown; gl: { domElement: HTMLCanvasElement } };
        };
      }
    ).__regulusR3F;
    const o = r3f?.scene.getObjectByName(target);
    if (!r3f || !o) return null;
    const { camera, gl } = r3f.get();
    const rect = gl.domElement.getBoundingClientRect();
    const p = o.getWorldPosition(o.position.clone()).project(camera);
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }, name);
}

/**
 * Collects what the page's terminal sockets (`/ws/term/<agentId>`) receive: binary frames are
 * the PTY bytes (scrollback first), decoded as UTF-8 and concatenated.
 */
export function collectTerminalOutput(page: Page): { text(): string } {
  let text = "";
  page.on("websocket", (ws: WebSocket) => {
    if (!new URL(ws.url()).pathname.startsWith("/ws/term/")) return;
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") text += payload.toString("utf8");
    });
  });
  return { text: () => text };
}
