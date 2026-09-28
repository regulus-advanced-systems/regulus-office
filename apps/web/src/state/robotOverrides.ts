/**
 * Client-side overrides of how a robot is drawn, for choreography the server
 * does not model: the send-home walk (#33) for now. While a robot has an
 * override, the robot layer (#29) must not draw it from `RobotState`; the
 * override owner draws it instead (scene/robots/sendHome/DepartingRobots.tsx),
 * even after the robot has left the FloorRoom state. `robot` is the last
 * `RobotState` seen, so colours and labels survive the removal.
 *
 * The pose changes every frame, so it lives in a mutable `pose` object that
 * the driver writes and renderers read in `useFrame`; only phase changes go
 * through `set` (and React renders).
 */
import type { AvatarAnimation, RobotState } from "@regulus/protocol";
import { create } from "zustand";

export type RobotOverrideKind = "send_home";

export interface OverridePose {
  x: number;
  z: number;
  heading: number;
  /** 1 = fully visible; shrinks to 0 as the robot steps into the elevator. */
  scale: number;
}

export interface RobotOverride {
  agentId: string;
  kind: RobotOverrideKind;
  robot: RobotState;
  animation: AvatarAnimation;
  /** Holding the box of desk things. */
  carrying: boolean;
  /** Written by the driver every frame; read it in `useFrame`, do not subscribe to it. */
  pose: OverridePose;
}

export interface RobotOverridesStore {
  overrides: Record<string, RobotOverride>;
  set: (override: RobotOverride) => void;
  patch: (agentId: string, patch: Partial<Omit<RobotOverride, "agentId" | "pose">>) => void;
  clear: (agentId: string) => void;
  clearAll: () => void;
}

export const useRobotOverrides = create<RobotOverridesStore>()((set) => ({
  overrides: {},
  set: (override) => set((s) => ({ overrides: { ...s.overrides, [override.agentId]: override } })),
  patch: (agentId, patch) =>
    set((s) => {
      const current = s.overrides[agentId];
      if (!current) return {};
      return { overrides: { ...s.overrides, [agentId]: { ...current, ...patch } } };
    }),
  clear: (agentId) =>
    set((s) => {
      if (!(agentId in s.overrides)) return {};
      const { [agentId]: _gone, ...rest } = s.overrides;
      return { overrides: rest };
    }),
  clearAll: () => set({ overrides: {} }),
}));

/** True while a robot is drawn by its override (the robot layer should skip it). */
export function hasRobotOverride(agentId: string): boolean {
  return agentId in useRobotOverrides.getState().overrides;
}
