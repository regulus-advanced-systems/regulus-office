import { describe, expect, test } from "bun:test";
import { PROVIDER_LIGHT_COLORS } from "../avatar/index.ts";
import { robotHenchmanLook } from "./robotLook.ts";

describe("robot look (#184)", () => {
  test("the published skin and the provider's colour as trim", () => {
    expect(robotHenchmanLook({ provider: "codex", skin: "standard" })).toEqual({
      skin: "standard",
      trim: PROVIDER_LIGHT_COLORS.codex,
    });
    expect(robotHenchmanLook({ provider: "claude-code", skin: "chef" })).toEqual({
      skin: "chef",
      trim: PROVIDER_LIGHT_COLORS["claude-code"],
    });
  });
});
