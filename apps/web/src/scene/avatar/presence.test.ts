import { describe, expect, test } from "bun:test";
import type { HumanPresence } from "@regulus/protocol";
import { ROBOT_CLIPS } from "./clips.ts";
import { avatarAnimationFor, presenceAnimation } from "./presence.ts";
import { SEATED_CLIPS } from "./seatedClips.ts";

const humanFixture: HumanPresence = {
  sessionId: "s1",
  userId: "u1",
  displayName: "Ada",
  role: "member",
  avatar: { colorSet: "teal", accessory: "antenna" },
  floorId: "lobby",
  position: { x: 0, z: 0, heading: 0 },
  animation: "walk",
  doing: "heading to the elevator",
  seatId: "",
  sharingScreen: false,
  joinedAt: 0,
};

describe("presence", () => {
  test("the wire animation is used as-is when standing", () => {
    expect(
      presenceAnimation({ animation: "walk", doing: "heading to the elevator", seatId: "" }),
    ).toBe("walk");
    expect(presenceAnimation({ animation: "wave", seatId: "" })).toBe("wave");
    expect(avatarAnimationFor(humanFixture)).toBe(ROBOT_CLIPS.walking);
  });

  test("seated humans never play standing idle/walk; standing humans never sit", () => {
    expect(presenceAnimation({ animation: "walk", doing: "", seatId: "desk-3" })).toBe("sit_idle");
    expect(presenceAnimation({ animation: "idle", doing: "", seatId: "couch-1" })).toBe("sit_idle");
    expect(presenceAnimation({ animation: "sit_idle", doing: "", seatId: "" })).toBe("idle");
    expect(presenceAnimation({ animation: "sit_type", doing: "", seatId: "" })).toBe("idle");
    expect(presenceAnimation({ animation: "celebrate", doing: "", seatId: "desk-3" })).toBe(
      "celebrate",
    );
  });

  test("`doing` refines generic animations", () => {
    expect(
      presenceAnimation({ animation: "sit_idle", doing: "typing in Ada's terminal", seatId: "d1" }),
    ).toBe("sit_type");
    expect(presenceAnimation({ animation: "idle", doing: "typing", seatId: "" })).toBe("idle");
    expect(presenceAnimation({ animation: "idle", doing: "watching robot Ada", seatId: "" })).toBe(
      "read",
    );
    expect(presenceAnimation({ animation: "idle", doing: "thinking", seatId: "" })).toBe("think");
    expect(presenceAnimation({ animation: "wave", doing: "reading", seatId: "" })).toBe("wave");
  });

  test("clip names come from the available list", () => {
    // A seated human holds the still seated pose (#159), not the sit-down transition.
    expect(avatarAnimationFor({ animation: "idle", doing: "", seatId: "d1" })).toBe(
      SEATED_CLIPS.idle,
    );
    expect(
      avatarAnimationFor({ animation: "idle", doing: "", seatId: "d1" }, [ROBOT_CLIPS.sitting]),
    ).toBe(ROBOT_CLIPS.sitting);
    expect(
      avatarAnimationFor({ animation: "celebrate", doing: "", seatId: "" }, [ROBOT_CLIPS.idle]),
    ).toBe(ROBOT_CLIPS.idle);
  });
});
