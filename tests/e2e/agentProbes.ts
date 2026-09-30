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
  /** Why the robot is in `error` (RobotState.statusReason), else "". */
  statusReason: string;
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
 * Starts sampling every robot's (status, action, animation, handRaised, and the reason of an
 * `error`) inside the page every 50 ms, so short-lived states are not missed between Playwright
 * polls. Read with {@link history}. These are what the scene drew: on a slow page a state can pass
 * without being drawn, so it also starts {@link recordStatuses} (what the page received).
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
        const entry =
          `${d.status}/${d.action}/${d.animation}/${d.handRaised ? "hand" : "-"}` +
          (d.statusReason ? ` (${d.statusReason})` : "");
        const h = w.__robotHistory ?? [];
        if (h[h.length - 1] !== entry) h.push(entry);
      });
    }, 50);
  });
  await recordStatuses(page);
}

/** Distinct `status/action/animation/hand[ (statusReason)]` samples since {@link recordRobots}, in order. */
export function history(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __robotHistory?: string[] }).__robotHistory ?? [],
  );
}

/**
 * Starts logging, per robot, every `status/action` the page's floor state received (the store
 * `?stats` publishes, apps/web/src/scene/perf/stats.ts). The store is updated on every state
 * patch, so a state that lasted one patch is in the log even when the page drew no frame and
 * React rendered no commit while it lasted (a software-rendered CI page draws 1-3 fps, #179).
 * Called by {@link recordRobots}; read with {@link statuses}.
 */
async function recordStatuses(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Robot = { status: string; action: string };
    type Snapshot = { state: { robots: Record<string, Robot> } | null };
    const w = window as unknown as {
      __regulusFloorStore?: {
        getState(): Snapshot;
        subscribe(listener: (s: Snapshot) => void): () => void;
      };
      __statusLog?: Record<string, string[]>;
      __statusUnsubscribe?: () => void;
    };
    const store = w.__regulusFloorStore;
    if (!store) throw new Error("no floor store on the page (needs ?stats)");
    w.__statusUnsubscribe?.();
    const log: Record<string, string[]> = {};
    w.__statusLog = log;
    const take = (s: Snapshot) => {
      for (const [agentId, r] of Object.entries(s.state?.robots ?? {})) {
        const entry = `${r.status}/${r.action}`;
        const list = (log[agentId] ??= []);
        if (list[list.length - 1] !== entry) list.push(entry);
      }
    };
    take(store.getState());
    w.__statusUnsubscribe = store.subscribe(take);
  });
}

/** Distinct `status/action` of one robot, in the order the page received them (see recordStatuses). */
export function statuses(page: Page, agentId: string): Promise<string[]> {
  return page.evaluate(
    (id) =>
      (window as unknown as { __statusLog?: Record<string, string[]> }).__statusLog?.[id] ?? [],
    agentId,
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
