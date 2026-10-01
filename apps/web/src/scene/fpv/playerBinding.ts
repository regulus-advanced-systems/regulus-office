/**
 * Binds the first-person rig to the player store (#15, `state/player.ts`),
 * so both views move the same avatar: the rig's collision-resolved step
 * goes through `applyInput` (walk animation, footsteps, `move` relay) and
 * the avatar faces the camera yaw, so remote viewers see where we look.
 */
import type { PlayerStore } from "../../state/player.ts";
import type { PlayerPose } from "./FirstPersonRig.tsx";

/** Smallest yaw change worth a store update, radians. */
const YAW_EPSILON = 1e-4;

interface StoreApi {
  getState: () => PlayerStore;
}

export interface PlayerBinding {
  getPose: () => PlayerPose;
  onMove: (dx: number, dz: number, dt: number, yaw: number) => void;
}

export function createPlayerBinding(store: StoreApi): PlayerBinding {
  return {
    getPose: () => store.getState(),
    onMove: (dx, dz, dt, yaw) => {
      const s = store.getState();
      // A click-to-walk target from third person must not keep pulling the avatar.
      if (s.path || s.target) s.clearTarget();
      const moving = dx !== 0 || dz !== 0;
      // The rig already chose walk or run (#223): keep its pace.
      if (moving) store.getState().applyInput(dx, dz, dt, dt > 0 ? Math.hypot(dx, dz) / dt : 0);
      else if (s.animation === "walk") s.setAnimation("idle");
      const now = store.getState();
      if (Math.abs(now.heading - yaw) > YAW_EPSILON) now.setPose(now.x, now.z, yaw);
    },
  };
}
