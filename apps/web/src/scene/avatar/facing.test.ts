/**
 * Walking henchmen face where they go (humans, remote humans, the send-home
 * walker): the avatar group is rotated by the heading of travel, the model
 * inside it by MODEL_YAW, exactly as RobotAvatar / LocalAvatar nest them.
 */
import { describe, expect, test } from "bun:test";
import { Group, Vector3 } from "three";
import { headingOfTravel } from "../movement/kinematics.ts";
import { MODEL_FORWARD, MODEL_YAW } from "./avatarRig.ts";

/** World direction of the model's face for an avatar group turned to `heading`. */
function renderedForward(heading: number): Vector3 {
  const avatar = new Group(); // LocalAvatar / RemoteAvatar / DepartingHenchman: rotation.y = heading
  avatar.rotation.y = heading;
  const model = new Group(); // RobotAvatar's inner model group
  model.rotation.y = MODEL_YAW;
  avatar.add(model);
  avatar.updateMatrixWorld(true);
  return MODEL_FORWARD.clone().transformDirection(model.matrixWorld);
}

describe("henchmen face the direction they move", () => {
  const moves: Array<[string, number, number]> = [
    ["+x", 1, 0],
    ["-x", -1, 0],
    ["+z", 0, 1],
    ["-z", 0, -1],
    ["+x+z (toward the iso camera)", 1, 1],
  ];
  for (const [name, dx, dz] of moves) {
    test(`moving ${name}`, () => {
      const velocity = new Vector3(dx, 0, dz).normalize();
      const forward = renderedForward(headingOfTravel(dx, dz));
      expect(forward.dot(velocity)).toBeCloseTo(1, 6);
    });
  }
});
