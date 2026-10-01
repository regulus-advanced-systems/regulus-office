/**
 * Runs send-home walks (#33): `startSendHome` snapshots the henchman and puts an
 * override in `state/henchmanOverrides.ts`; `tickSendHome` (called every frame by
 * DepartingHenchmen) advances each plan (plan.ts), writes the pose into the
 * override and clears it when the henchman is gone. The henchman usually leaves the
 * OperationRoom state around the time `agent.leaving` arrives, so the last few
 * seconds of removed henchmen are remembered for the snapshot.
 */

import type { HenchmanState } from "@regulus/protocol";
import type { RoomTemplate } from "@regulus/room-layout";
import { useHenchmanOverrides } from "../../../state/henchmanOverrides.ts";
import { type OperationStore, useOperationStore } from "../../../state/operation.ts";
import { advance, frameFor, planSendHome, type SendHomeState } from "./plan.ts";

/** How long a henchman removed from the floor state can still be sent home. */
const REMEMBER_MS = 10_000;

const plans = new Map<string, SendHomeState>();
const removed = new Map<string, { henchman: HenchmanState; at: number }>();
let sceneTemplate: RoomTemplate | null = null;

/** The room template the scene is drawing (set by DepartingHenchmen). */
export function setSendHomeTemplate(template: RoomTemplate | null): void {
  sceneTemplate = template;
}

/** Remember henchmen that leave the operation state, for a late `agent.leaving`. */
export function watchRemovedHenchmen(store = useOperationStore, now = Date.now): () => void {
  let previous = store.getState().state?.henchmen ?? {};
  let operationId = store.getState().operationId;
  return store.subscribe((s: OperationStore) => {
    const henchmen = s.state?.henchmen ?? {};
    const t = now();
    if (s.operationId !== operationId) {
      operationId = s.operationId;
      removed.clear();
      resetSendHome();
    } else {
      for (const [id, henchman] of Object.entries(previous)) {
        if (!(id in henchmen)) removed.set(id, { henchman, at: t });
      }
    }
    for (const [id, entry] of removed) if (t - entry.at > REMEMBER_MS) removed.delete(id);
    previous = henchmen;
  });
}

/** The henchman as currently published, or as last seen before it was removed. */
export function henchmanSnapshot(
  agentId: string,
  store = useOperationStore,
): HenchmanState | undefined {
  return store.getState().state?.henchmen[agentId] ?? removed.get(agentId)?.henchman;
}

export interface StartOptions {
  reducedMotion: boolean;
  template?: RoomTemplate | null;
  henchman?: HenchmanState;
}

/** Begin the walk; false when there is nothing to animate (no scene, henchman or motion). */
export function startSendHome(agentId: string, options: StartOptions): boolean {
  const template = options.template ?? sceneTemplate;
  const henchman = options.henchman ?? henchmanSnapshot(agentId);
  if (!template || !henchman || options.reducedMotion || plans.has(agentId)) return false;
  const plan = planSendHome(template, henchman.seatId);
  plans.set(agentId, plan);
  const frame = frameFor(plan);
  useHenchmanOverrides.getState().set({
    agentId,
    kind: "send_home",
    henchman,
    animation: frame.animation,
    carrying: frame.carrying,
    pose: { ...plan.pose, scale: plan.scale },
  });
  return true;
}

/** Advance every walk by `dt` seconds. */
export function tickSendHome(dt: number): void {
  const store = useHenchmanOverrides.getState();
  for (const [agentId, state] of plans) {
    const override = store.overrides[agentId];
    const next = advance(state, dt);
    if (!override || next.phase === "gone") {
      plans.delete(agentId);
      store.clear(agentId);
      continue;
    }
    plans.set(agentId, next);
    override.pose.x = next.pose.x;
    override.pose.z = next.pose.z;
    override.pose.heading = next.pose.heading;
    override.pose.scale = next.scale;
    const frame = frameFor(next);
    if (frame.animation !== override.animation || frame.carrying !== override.carrying) {
      store.patch(agentId, frame);
    }
  }
}

export function activeSendHomes(): string[] {
  return [...plans.keys()];
}

/** Drop every walk (operation change, tests). */
export function resetSendHome(): void {
  for (const agentId of plans.keys()) useHenchmanOverrides.getState().clear(agentId);
  plans.clear();
}
