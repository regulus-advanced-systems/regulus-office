/**
 * Runs send-home walks (#33): `startSendHome` snapshots the robot and puts an
 * override in `state/robotOverrides.ts`; `tickSendHome` (called every frame by
 * DepartingRobots) advances each plan (plan.ts), writes the pose into the
 * override and clears it when the robot is gone. The robot usually leaves the
 * FloorRoom state around the time `agent.leaving` arrives, so the last few
 * seconds of removed robots are remembered for the snapshot.
 */
import type { RoomTemplate } from "@regulus/room-layout";
import type { RobotState } from "@regulus/protocol";
import { type FloorStore, useFloorStore } from "../../../state/floor.ts";
import { useRobotOverrides } from "../../../state/robotOverrides.ts";
import { advance, frameFor, planSendHome, type SendHomeState } from "./plan.ts";

/** How long a robot removed from the floor state can still be sent home. */
const REMEMBER_MS = 10_000;

const plans = new Map<string, SendHomeState>();
const removed = new Map<string, { robot: RobotState; at: number }>();
let sceneTemplate: RoomTemplate | null = null;

/** The floor template the scene is drawing (set by DepartingRobots). */
export function setSendHomeTemplate(template: RoomTemplate | null): void {
  sceneTemplate = template;
}

/** Remember robots that leave the floor state, for a late `agent.leaving`. */
export function watchRemovedRobots(store = useFloorStore, now = Date.now): () => void {
  let previous = store.getState().state?.robots ?? {};
  let floorId = store.getState().floorId;
  return store.subscribe((s: FloorStore) => {
    const robots = s.state?.robots ?? {};
    const t = now();
    if (s.floorId !== floorId) {
      floorId = s.floorId;
      removed.clear();
      resetSendHome();
    } else {
      for (const [id, robot] of Object.entries(previous)) {
        if (!(id in robots)) removed.set(id, { robot, at: t });
      }
    }
    for (const [id, entry] of removed) if (t - entry.at > REMEMBER_MS) removed.delete(id);
    previous = robots;
  });
}

/** The robot as currently published, or as last seen before it was removed. */
export function robotSnapshot(agentId: string, store = useFloorStore): RobotState | undefined {
  return store.getState().state?.robots[agentId] ?? removed.get(agentId)?.robot;
}

export interface StartOptions {
  reducedMotion: boolean;
  template?: RoomTemplate | null;
  robot?: RobotState;
}

/** Begin the walk; false when there is nothing to animate (no scene, robot or motion). */
export function startSendHome(agentId: string, options: StartOptions): boolean {
  const template = options.template ?? sceneTemplate;
  const robot = options.robot ?? robotSnapshot(agentId);
  if (!template || !robot || options.reducedMotion || plans.has(agentId)) return false;
  const plan = planSendHome(template, robot.seatId);
  plans.set(agentId, plan);
  const frame = frameFor(plan);
  useRobotOverrides.getState().set({
    agentId,
    kind: "send_home",
    robot,
    animation: frame.animation,
    carrying: frame.carrying,
    pose: { ...plan.pose, scale: plan.scale },
  });
  return true;
}

/** Advance every walk by `dt` seconds. */
export function tickSendHome(dt: number): void {
  const store = useRobotOverrides.getState();
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

/** Drop every walk (floor change, tests). */
export function resetSendHome(): void {
  for (const agentId of plans.keys()) useRobotOverrides.getState().clear(agentId);
  plans.clear();
}
