import { describe, expect, test } from "bun:test";
import { COLOR_SET_IDS, PROVIDER_LIGHT_COLORS } from "../avatar/index.ts";
import { colorSetForOwner, robotAvatarLook } from "./robotLook.ts";

describe("robot look", () => {
  test("one colour set per owner, from the known sets", () => {
    expect(colorSetForOwner("u1")).toBe(colorSetForOwner("u1"));
    expect(COLOR_SET_IDS).toContain(colorSetForOwner("someone-else"));
  });

  test("provider chest light and antenna", () => {
    const look = robotAvatarLook({ ownerUserId: "u1", provider: "codex" });
    expect(look.chestLight).toBe(PROVIDER_LIGHT_COLORS.codex);
    expect(look.look.accessory).toBe("antenna");
  });
});
