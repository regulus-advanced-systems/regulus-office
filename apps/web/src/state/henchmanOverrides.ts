/**
 * Client-side overrides of how a henchman is drawn, for choreography the server
 * does not model: the send-home walk (#33) for now. While a henchman has an
 * override, the henchman layer (#29) must not draw it from `HenchmanState`; the
 * override owner draws it instead (scene/henchmen/sendHome/DepartingHenchmen.tsx),
 * even after the henchman has left the OperationRoom state. `henchman` is the last
 * `HenchmanState` seen, so colours and labels survive the removal.
 *
 * The pose changes every frame, so it lives in a mutable `pose` object that
 * the driver writes and renderers read in `useFrame`; only phase changes go
 * through `set` (and React renders).
 */
import type { AvatarAnimation, HenchmanState } from "@regulus/protocol";
import { create } from "zustand";

export type HenchmanOverrideKind = "send_home";

export interface OverridePose {
  x: number;
  z: number;
  heading: number;
  /** 1 = fully visible; shrinks to 0 as the henchman steps into the elevator. */
  scale: number;
}

export interface HenchmanOverride {
  agentId: string;
  kind: HenchmanOverrideKind;
  henchman: HenchmanState;
  animation: AvatarAnimation;
  /** Holding the box of desk things. */
  carrying: boolean;
  /** Written by the driver every frame; read it in `useFrame`, do not subscribe to it. */
  pose: OverridePose;
}

export interface HenchmanOverridesStore {
  overrides: Record<string, HenchmanOverride>;
  set: (override: HenchmanOverride) => void;
  patch: (agentId: string, patch: Partial<Omit<HenchmanOverride, "agentId" | "pose">>) => void;
  clear: (agentId: string) => void;
  clearAll: () => void;
}

export const useHenchmanOverrides = create<HenchmanOverridesStore>()((set) => ({
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

/** True while a henchman is drawn by its override (the henchman layer should skip it). */
export function hasHenchmanOverride(agentId: string): boolean {
  return agentId in useHenchmanOverrides.getState().overrides;
}
