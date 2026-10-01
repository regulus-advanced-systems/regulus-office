/**
 * The local human's pose, click target and animation (SPEC §9.2 click-to-walk
 * and WASD, §9.3 idle/walk). Movement authority stays on the client: the
 * scene drives this store every frame and the net layer relays the pose as
 * `move`. First-person controls (#17) share it through `applyInput` /
 * `setPose`, so both views move the same avatar. In third person the
 * standing avatar turns toward the cursor through `faceToward` (#119).
 * Running (#223): `advance` and `applyInput` take a speed or the Shift
 * state, and a path set with `run` (a double-click) is walked at a run
 * until it ends or is replaced; `gait` tells the avatar which cycle to play.
 */

import type { Vec2 } from "@regulus/room-layout";
import type { AvatarAnimation } from "@regulus/protocol";
import { create } from "zustand";
import { cursorHeading } from "../scene/movement/cursorFacing.ts";
import { type Gait, gaitForSpeed, selectSpeed } from "../scene/movement/gait.ts";
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
  /** The current path was set to be run (a double-click, #223). */
  pathRun: boolean;
  /** Walking or running, while `animation` is "walk". */
  gait: Gait;
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
  /**
   * Walk (or with `run`, run) to a point; returns false (and clears any
   * target) when unreachable. A new target replaces the old one and its pace.
   */
  setTarget: (x: number, z: number, run?: boolean) => boolean;
  clearTarget: () => void;
  /**
   * Direct control: move along the ground direction `(dx, dz)` for `dt`
   * seconds at `speed` (default walking). Drops any click path.
   */
  applyInput: (dx: number, dz: number, dt: number, speed?: number) => void;
  /**
   * Follow the current path for `dt` seconds, running while `shift` is held
   * or the path was set to run; settles to idle when there is none.
   */
  advance: (dt: number, shift?: boolean) => void;
  /**
   * Third person (#119): while standing, turn toward the floor point `(x, z)`
   * under the cursor at TURN_RATE for `dt` seconds. Does nothing while a
   * path is being walked (the robot faces its travel then) or when the point
   * is inside the dead zone around the robot's feet.
   */
  faceToward: (x: number, z: number, dt: number) => void;
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
  pathRun: false,
  gait: "walk" as Gait,
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
        pathRun: false,
        gait: "walk",
        animation: "idle",
      }),
    setPose: (x, z, heading) => set({ x, z, heading }),
    setAnimation: (animation) => set((s) => (s.animation === animation ? {} : { animation })),
    setTarget: (x, z, run = false) => {
      const s = get();
      const target = { x, z };
      const path = s.navigation ? s.navigation.plan({ x: s.x, z: s.z }, target) : [target];
      if (!path) {
        set({ target: null, path: null, pathRun: false });
        return false;
      }
      set({ target, path, pathRun: run });
      return true;
    },
    clearTarget: () => set({ target: null, path: null, pathRun: false }),
    applyInput: (dx, dz, dt, speed = WALK_SPEED) => {
      const len = Math.hypot(dx, dz);
      if (!(len > 0) || !(dt > 0)) return;
      const s = get();
      const ux = dx / len;
      const uz = dz / len;
      const step = speed * dt;
      const walkable = s.navigation?.walkable ?? alwaysWalkable;
      const next = stepWithCollision(walkable, s, ux * step, uz * step);
      const moved = Math.hypot(next.x - s.x, next.z - s.z);
      const heading = turnToward(s.heading, headingOfTravel(ux, uz), TURN_RATE * dt);
      set({
        x: next.x,
        z: next.z,
        heading,
        animation: moved > 0 ? "walk" : "idle",
        gait: moved > 0 ? gaitForSpeed(moved / dt, s.gait) : "walk",
        target: null,
        path: null,
        pathRun: false,
        distanceWalked: s.distanceWalked + moved,
      });
    },
    advance: (dt, shift = false) => {
      const s = get();
      if (!s.path || s.path.length === 0) {
        if (s.path || s.target || s.animation === "walk")
          set({ path: null, target: null, pathRun: false, gait: "walk", animation: "idle" });
        return;
      }
      const speed = selectSpeed({ shift, pathRun: s.pathRun });
      const result = followPath(s, s.path, dt, { speed });
      set({
        x: result.pose.x,
        z: result.pose.z,
        heading: result.pose.heading,
        path: result.arrived ? null : result.path,
        target: result.arrived ? null : s.target,
        pathRun: result.arrived ? false : s.pathRun,
        animation: result.arrived ? "idle" : "walk",
        gait: result.arrived ? "walk" : gaitForSpeed(speed),
        distanceWalked: s.distanceWalked + result.moved,
      });
    },
    faceToward: (x, z, dt) => {
      const s = get();
      if (!s.spawned || s.path || !(dt > 0)) return;
      const target = cursorHeading(s, { x, z });
      if (target === null) return;
      const heading = turnToward(s.heading, target, TURN_RATE * dt);
      if (heading !== s.heading) set({ heading });
    },
    reset: () => set({ ...INITIAL }),
  }));
}

export const usePlayerStore = createPlayerStore();

export function selectPlayerPose(s: Pose): Pose {
  return { x: s.x, z: s.z, heading: s.heading };
}
