import { describe, expect, test } from "bun:test";
import {
  CreateKeyProfileRequest,
  isOfficeKeyPreset,
  KEY_PRESET_IDS,
  KEY_PRESETS,
  KeyProfileInfo,
  ProviderBaseUrl,
  presetForProfile,
} from "./provider-connect.ts";

describe("key presets", () => {
  test("only metered providers may be office keys (SPEC §8 rule 3, D2)", () => {
    const office = KEY_PRESET_IDS.filter(isOfficeKeyPreset);
    expect(office).toEqual(["anthropic", "openai", "gemini", "deepseek"]);
  });

  test("stored profiles map back to their preset", () => {
    for (const preset of Object.values(KEY_PRESETS)) {
      if (!preset.baseUrl && preset.authKind === "base_url_key") continue;
      expect(
        presetForProfile({
          provider: preset.provider,
          authKind: preset.authKind,
          baseUrl: preset.baseUrl ?? null,
        }),
      ).toBe(preset.id);
    }
    expect(
      presetForProfile({
        provider: "claude-code",
        authKind: "base_url_key",
        baseUrl: "https://gw.example",
      }),
    ).toBe("custom-claude");
    expect(presetForProfile({ provider: "custom", authKind: "cli_login", baseUrl: null })).toBe(
      null,
    );
  });
});

describe("request and response shapes", () => {
  test("base URLs must be plain https", () => {
    expect(ProviderBaseUrl.safeParse("https://api.example/anthropic").success).toBe(true);
    for (const bad of [
      "http://api.example",
      "https://user:pw@api.example",
      "https://api.example/?k=1",
      "https://api.example/#x",
      "ftp://api.example",
      "not a url",
    ]) {
      expect(ProviderBaseUrl.safeParse(bad).success).toBe(false);
    }
  });

  test("keys are printable ASCII without spaces; unknown fields are refused", () => {
    const ok = { preset: "anthropic", label: "L", apiKey: "sk-FAKE-0123456789" };
    expect(CreateKeyProfileRequest.parse(ok).owner).toBe("me");
    expect(CreateKeyProfileRequest.safeParse({ ...ok, apiKey: "has space inside" }).success).toBe(
      false,
    );
    expect(CreateKeyProfileRequest.safeParse({ ...ok, userId: "u2" }).success).toBe(false);
  });

  test("a profile summary has no room for a key or envelope", () => {
    const info = {
      id: "p1",
      label: "L",
      provider: "codex",
      authKind: "api_key",
      preset: "openai",
      owner: "me",
      baseUrlHost: null,
      verifiedAt: null,
      createdAt: 1,
    } as const;
    expect(KeyProfileInfo.parse(info)).toEqual(info);
    expect(KeyProfileInfo.safeParse({ ...info, encryptedSecret: "x" }).success).toBe(false);
    expect(KeyProfileInfo.safeParse({ ...info, apiKey: "sk-x" }).success).toBe(false);
  });
});
