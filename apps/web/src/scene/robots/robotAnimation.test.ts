import { describe, expect, test } from "bun:test";
import { AGENT_ACTIONS, AGENT_STATUSES } from "@regulus/protocol";
import { ROBOT_CLIPS, resolveSeatedClip } from "../avatar/clips.ts";
import {
  celebrates,
  ONE_SHOT_MS,
  raisesHand,
  robotAnimationFor,
  robotLookFor,
  settleOneShot,
} from "./robotAnimation.ts";

describe("action -> animation", () => {
  test("working actions map to the SPEC §9.3 clips", () => {
    const at = (action: (typeof AGENT_ACTIONS)[number]) =>
      robotAnimationFor({ status: "working", action });
    expect(at("typing")).toBe("sit_type");
    expect(at("editing")).toBe("sit_type");
    expect(at("running_tests")).toBe("sit_type");
    expect(at("none")).toBe("sit_type");
    expect(at("reading")).toBe("read");
    expect(at("browsing")).toBe("read");
    expect(at("thinking")).toBe("think");
    expect(at("failing")).toBe("facepalm");
    expect(at("celebrating")).toBe("celebrate");
  });

  test("status wins over action: done celebrates, error facepalms, the rest sit", () => {
    expect(robotAnimationFor({ status: "done", action: "none" })).toBe("celebrate");
    expect(robotAnimationFor({ status: "error", action: "typing" })).toBe("facepalm");
    for (const status of [
      "starting",
      "waiting_permission",
      "waiting_input",
      "exited",
      "offline",
    ] as const)
      expect(robotAnimationFor({ status, action: "typing" })).toBe("sit_idle");
    expect(robotAnimationFor({ status: "idle", action: "typing" })).toBe("sit_idle");
    expect(robotAnimationFor({ status: "idle", action: "celebrating" })).toBe("celebrate");
  });

  test("every status/action pair maps to something", () => {
    for (const status of AGENT_STATUSES)
      for (const action of AGENT_ACTIONS)
        expect(typeof robotAnimationFor({ status, action })).toBe("string");
  });

  test("desk animations stay seated with the Quaternius clips; one-shots stand", () => {
    expect(resolveSeatedClip("sit_type")).toBe(ROBOT_CLIPS.sitting);
    // No read / think clips in the GLB: the robot stays in its chair.
    expect(resolveSeatedClip("read")).toBe(ROBOT_CLIPS.sitting);
    expect(resolveSeatedClip("think")).toBe(ROBOT_CLIPS.sitting);
    expect(resolveSeatedClip("celebrate")).toBe(ROBOT_CLIPS.sitting);
    expect(robotLookFor("read")).toEqual({
      animation: "read",
      seated: true,
      papers: true,
      spin: false,
    });
    expect(robotLookFor("celebrate")).toMatchObject({ seated: false, spin: true });
    expect(robotLookFor("facepalm").seated).toBe(false);
  });

  test("a dedicated clip is used when a re-exported GLB has one", () => {
    const withRead = [ROBOT_CLIPS.sitting, ROBOT_CLIPS.idle, "RobotArmature|Robot_Read"];
    expect(resolveSeatedClip("read", withRead)).toBe("RobotArmature|Robot_Read");
  });
});

describe("one-shots and transitions", () => {
  test("celebrate and facepalm give way to sit_idle", () => {
    const limit = ONE_SHOT_MS.celebrate ?? 0;
    expect(settleOneShot("celebrate", 1000, 1000 + limit - 1)).toBe("celebrate");
    expect(settleOneShot("celebrate", 1000, 1000 + limit)).toBe("sit_idle");
    expect(settleOneShot("facepalm", 0, 60_000)).toBe("sit_idle");
    expect(settleOneShot("sit_type", 0, 60_000)).toBe("sit_type");
  });

  test("confetti on the transition into done, not on joining a floor", () => {
    const working = { status: "working", action: "typing" } as const;
    const done = { status: "done", action: "celebrating" } as const;
    expect(celebrates(working, done)).toBe(true);
    expect(celebrates(done, done)).toBe(false);
    expect(celebrates(undefined, done)).toBe(false);
  });

  test("the ding plays when a hand goes up", () => {
    expect(raisesHand({ handRaised: false }, { handRaised: true })).toBe(true);
    expect(raisesHand({ handRaised: true }, { handRaised: true })).toBe(false);
    expect(raisesHand(undefined, { handRaised: true })).toBe(false);
  });
});
