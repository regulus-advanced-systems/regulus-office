import { describe, expect, test } from "bun:test";
import { resolveServerUrl, toWebSocketUrl } from "./serverUrl.ts";

describe("server url", () => {
  test("falls back to the page origin when the env var is unset or blank", () => {
    expect(resolveServerUrl(undefined, "https://office.example")).toBe("https://office.example");
    expect(resolveServerUrl("   ", "https://office.example")).toBe("https://office.example");
  });

  test("uses VITE_OFFICE_URL when set and strips trailing slashes", () => {
    expect(resolveServerUrl("http://localhost:3000/", "https://x")).toBe("http://localhost:3000");
    expect(resolveServerUrl("ws://localhost:3000//", "https://x")).toBe("ws://localhost:3000");
  });

  test("converts http(s) to ws(s)", () => {
    expect(toWebSocketUrl("http://a:1")).toBe("ws://a:1");
    expect(toWebSocketUrl("https://a")).toBe("wss://a");
    expect(toWebSocketUrl("wss://a")).toBe("wss://a");
  });
});
