import { describe, expect, test } from "bun:test";
import { PROVIDER_LIGHT_COLORS } from "../avatar/index.ts";
import { henchmanSkinLook } from "./henchmanLook.ts";

describe("henchman look (#184)", () => {
  test("the published skin and the provider's colour as trim", () => {
    expect(henchmanSkinLook({ provider: "codex", skin: "standard" })).toEqual({
      skin: "standard",
      trim: PROVIDER_LIGHT_COLORS.codex,
    });
    expect(henchmanSkinLook({ provider: "claude-code", skin: "chef" })).toEqual({
      skin: "chef",
      trim: PROVIDER_LIGHT_COLORS["claude-code"],
    });
  });
});
