import { describe, expect, test } from "bun:test";
import { AGENT_ACTIONS, AGENT_STATUSES } from "@regulus/protocol";
import { ROBOT_CLIP_NAMES, ROBOT_CLIPS, resolveSeatedClip } from "../avatar/clips.ts";
import { SEATED_CLIPS } from "../avatar/seatedClips.ts";
import {
  calmFor,
  henchmanAnimationFor,
  henchmanLookFor,
  raisedHandFor,
  raisesHand,
  STILL,
} from "./henchmanAnimation.ts";

describe("action -> animation", () => {
  test("working actions map to the SPEC §9.3 clips", () => {
    const at = (action: (typeof AGENT_ACTIONS)[number]) =>
      henchmanAnimationFor({ status: "working", action });
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
    expect(henchmanAnimationFor({ status: "done", action: "none" })).toBe("celebrate");
    expect(henchmanAnimationFor({ status: "error", action: "typing" })).toBe("facepalm");
    for (const status of [
      "starting",
      "waiting_permission",
      "waiting_input",
      "exited",
      "offline",
    ] as const)
      expect(henchmanAnimationFor({ status, action: "typing" })).toBe("sit_idle");
    expect(henchmanAnimationFor({ status: "idle", action: "typing" })).toBe("sit_idle");
    expect(henchmanAnimationFor({ status: "idle", action: "celebrating" })).toBe("celebrate");
  });

  test("every status/action pair maps to something", () => {
    for (const status of AGENT_STATUSES)
      for (const action of AGENT_ACTIONS)
        expect(typeof henchmanAnimationFor({ status, action })).toBe("string");
  });

  test("desk animations stay seated with the built seated clips; one-shots stand", () => {
    expect(resolveSeatedClip("sit_type")).toBe(SEATED_CLIPS.type);
    expect(resolveSeatedClip("sit_idle")).toBe(SEATED_CLIPS.idle);
    // No read / think clips in the GLB: seated stand-ins, the henchman stays in its chair.
    expect(resolveSeatedClip("read")).toBe(SEATED_CLIPS.read);
    expect(resolveSeatedClip("think")).toBe(SEATED_CLIPS.think);
    expect(resolveSeatedClip("celebrate")).toBe(SEATED_CLIPS.idle);
    // The GLB alone: Robot_Sitting (a sit-down transition) is only the last resort.
    expect(resolveSeatedClip("read", ROBOT_CLIP_NAMES)).toBe(ROBOT_CLIPS.sitting);
    expect(henchmanLookFor("read")).toEqual({
      animation: "read",
      seated: true,
      papers: true,
      spin: false,
    });
    expect(henchmanLookFor("celebrate")).toMatchObject({ seated: false, spin: true });
    expect(henchmanLookFor("facepalm").seated).toBe(false);
  });

  test("a dedicated clip is used when a re-exported GLB has one", () => {
    const withRead = [ROBOT_CLIPS.sitting, ROBOT_CLIPS.idle, "RobotArmature|Robot_Read"];
    expect(resolveSeatedClip("read", withRead)).toBe("RobotArmature|Robot_Read");
  });
});

describe("still unless working (#159)", () => {
  test("starting, idle, waiting and exited henchmen hold the still seated clip", () => {
    for (const status of [
      "starting",
      "idle",
      "waiting_input",
      "waiting_permission",
      "exited",
    ] as const) {
      const animation = henchmanAnimationFor({ status, action: "none" });
      expect([status, animation]).toEqual([status, STILL]);
      expect(resolveSeatedClip(animation)).toBe(SEATED_CLIPS.idle);
    }
  });

  test("working animates by action", () => {
    const clip = (action: (typeof AGENT_ACTIONS)[number]) =>
      resolveSeatedClip(henchmanAnimationFor({ status: "working", action }));
    expect(clip("typing")).toBe(SEATED_CLIPS.type);
    expect(clip("editing")).toBe(SEATED_CLIPS.type);
    expect(clip("running_tests")).toBe(SEATED_CLIPS.type);
    expect(clip("reading")).toBe(SEATED_CLIPS.read);
    expect(clip("thinking")).toBe(SEATED_CLIPS.think);
  });

  test("only a henchman waiting for permission raises its hand", () => {
    expect(raisedHandFor({ status: "waiting_permission", handRaised: true })).toBe(true);
    expect(raisedHandFor({ status: "waiting_input", handRaised: true })).toBe(false);
    expect(raisedHandFor({ status: "idle", handRaised: false })).toBe(false);
  });

  test("reduced motion keeps every henchman still in its chair", () => {
    for (const animation of ["sit_type", "read", "think", "celebrate", "facepalm"] as const)
      expect(calmFor(animation, true)).toBe(STILL);
    expect(calmFor("sit_type", false)).toBe("sit_type");
  });
});

describe("transitions", () => {
  test("the ding plays when a hand goes up", () => {
    expect(raisesHand({ handRaised: false }, { handRaised: true })).toBe(true);
    expect(raisesHand({ handRaised: true }, { handRaised: true })).toBe(false);
    expect(raisesHand(undefined, { handRaised: true })).toBe(false);
  });
});
