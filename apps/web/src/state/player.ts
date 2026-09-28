/**
 * The local human's pose, click target and animation (SPEC §9.2 click-to-walk
 * and WASD, §9.3 idle/walk). Movement authority stays on the client: the
 * scene drives this store every frame and the net layer relays the pose as
 * `move`. First-person controls (#17) share it through `applyInput` /
 * `setPose`, so both views move the same avatar.
 */

import type { Vec2 } from "@regulus/floor-layout";
import type { AvatarAnimation } from "@regulus/protocol";
import { create } from "zustand";
import {
  headingOfTravel,
  type Pose,
  stepWithCollision,
  TURN_RATE,
  turnToward,
  WALK_SPEED,
  type Walkable,
} from "../scene/movement/kinematics.ts";
import { followPath } from "../scene/movement/pathFollower.ts";

export interface PlayerNavigation {
  /** Cell walkability at a world point (nav grid). */
  walkable: Walkable;
  /** Waypoints from `from` to `to` (excluding `from`), or null when unreachable. */
  plan: (from: Vec2, to: Vec2) => Vec2[] | null;
}

export interface PlayerStore extends Pose {
  animation: AvatarAnimation;
  /** Click destination while walking to one. */
  target: Vec2 | null;
  /** Waypoints still ahead on the way to `target`. */
  path: Vec2[] | null;
  /** True once `spawnAt` placed the avatar on a floor. */
  spawned: boolean;
  /** Which floor the avatar was spawned on (see MovementController `floorKey`). */
  spawnKey: string | null;
  /** Metres walked since spawn; the footstep hook watches it. */
  distanceWalked: number;
  navigation: PlayerNavigation | null;

  setNavigation: (navigation: PlayerNavigation | null) => void;
  spawnAt: (pose: Pose, key?: string) => void;
  setPose: (x: number, z: number, heading: number) => void;
  setAnimation: (animation: AvatarAnimation) => void;
  /** Walk to a point; returns false (and clears any target) when unreachable. */
  setTarget: (x: number, z: number) => boolean;
  clearTarget: () => void;
  /** Direct control: move along the ground direction `(dx, dz)` for `dt` seconds. */
  applyInput: (dx: number, dz: number, dt: number) => void;
  /** Follow the current path for `dt` seconds; settles to idle when there is none. */
  advance: (dt: number) => void;
  reset: () => void;
}

const alwaysWalkable: Walkable = () => true;

const INITIAL = {
  x: 0,
  z: 0,
  heading: 0,
  animation: "idle" as AvatarAnimation,
  target: null,
  path: null,
  spawned: false,
  spawnKey: null,
  distanceWalked: 0,
  navigation: null,
};

export function createPlayerStore() {
  return create<PlayerStore>()((set, get) => ({
    ...INITIAL,
    setNavigation: (navigation) => set({ navigation }),
    spawnAt: (pose, key) =>
      set({
        x: pose.x,
        z: pose.z,
        heading: pose.heading,
        spawned: true,
        spawnKey: key ?? null,
        target: null,
        path: null,
        animation: "idle",
      }),
    setPose: (x, z, heading) => set({ x, z, heading }),
    setAnimation: (animation) => set((s) => (s.animation === animation ? {} : { animation })),
    setTarget: (x, z) => {
      const s = get();
      const target = { x, z };
      const path = s.navigation ? s.navigation.plan({ x: s.x, z: s.z }, target) : [target];
      if (!path) {
        set({ target: null, path: null });
        return false;
      }
      set({ target, path });
      return true;
    },
    clearTarget: () => set({ target: null, path: null }),
    applyInput: (dx, dz, dt) => {
      const len = Math.hypot(dx, dz);
      if (!(len > 0) || !(dt > 0)) return;
      const s = get();
      const ux = dx / len;
      const uz = dz / len;
      const step = WALK_SPEED * dt;
      const walkable = s.navigation?.walkable ?? alwaysWalkable;
      const next = stepWithCollision(walkable, s, ux * step, uz * step);
      const moved = Math.hypot(next.x - s.x, next.z - s.z);
      const heading = turnToward(s.heading, headingOfTravel(ux, uz), TURN_RATE * dt);
      set({
        x: next.x,
        z: next.z,
        heading,
        animation: moved > 0 ? "walk" : "idle",
        target: null,
        path: null,
        distanceWalked: s.distanceWalked + moved,
      });
    },
    advance: (dt) => {
      const s = get();
      if (!s.path || s.path.length === 0) {
        if (s.path || s.target || s.animation === "walk")
          set({ path: null, target: null, animation: "idle" });
        return;
      }
      const result = followPath(s, s.path, dt);
      set({
        x: result.pose.x,
        z: result.pose.z,
        heading: result.pose.heading,
        path: result.arrived ? null : result.path,
        target: result.arrived ? null : s.target,
        animation: result.arrived ? "idle" : "walk",
        distanceWalked: s.distanceWalked + result.moved,
      });
    },
    reset: () => set({ ...INITIAL }),
  }));
}

export const usePlayerStore = createPlayerStore();

export function selectPlayerPose(s: Pose): Pose {
  return { x: s.x, z: s.z, heading: s.heading };
}
