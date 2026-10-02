import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import {
  defaultLiveKitUrl,
  describeMediaConfig,
  loadMediaConfig,
  MediaConfigError,
} from "./config.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("media config (#48)", () => {
  test("no key pair: media is off", () => {
    expect(loadMediaConfig({}, "https://office.example")).toBeNull();
    expect(
      loadMediaConfig({ LIVEKIT_API_KEY: " ", LIVEKIT_API_SECRET: "" }, "https://office.example"),
    ).toBeNull();
  });

  test("half a key pair is a configuration error", () => {
    expect(() => loadMediaConfig({ LIVEKIT_API_KEY: "k" }, "https://o.example")).toThrow(
      MediaConfigError,
    );
    expect(() => loadMediaConfig({ LIVEKIT_API_SECRET: SECRET }, "https://o.example")).toThrow(
      MediaConfigError,
    );
  });

  test("defaults to the office origin under /livekit (Caddy proxies it)", () => {
    expect(defaultLiveKitUrl("https://office.example")).toBe("wss://office.example/livekit");
    expect(defaultLiveKitUrl("http://localhost:4600/")).toBe("ws://localhost:4600/livekit");
    const c = loadMediaConfig(
      { LIVEKIT_API_KEY: "APIk", LIVEKIT_API_SECRET: SECRET },
      "https://office.example",
    );
    expect(c?.url).toBe("wss://office.example/livekit");
    expect(c?.room).toBe("office");
  });

  test("LIVEKIT_URL overrides; http(s) becomes ws(s); ws from an https office is refused", () => {
    const env = { LIVEKIT_API_KEY: "APIk", LIVEKIT_API_SECRET: SECRET };
    expect(
      loadMediaConfig({ ...env, LIVEKIT_URL: "http://localhost:7880" }, "http://localhost:4600")
        ?.url,
    ).toBe("ws://localhost:7880");
    expect(
      loadMediaConfig({ ...env, LIVEKIT_URL: "https://lk.example/" }, "https://office.example")
        ?.url,
    ).toBe("wss://lk.example");
    expect(() =>
      loadMediaConfig({ ...env, LIVEKIT_URL: "ws://lk.example" }, "https://office.example"),
    ).toThrow(MediaConfigError);
    expect(() =>
      loadMediaConfig({ ...env, LIVEKIT_URL: "ftp://lk.example" }, "https://office.example"),
    ).toThrow(MediaConfigError);
  });

  test("the secret never shows in a log dump", () => {
    const c = loadMediaConfig(
      { LIVEKIT_API_KEY: "APIk", LIVEKIT_API_SECRET: SECRET },
      "https://office.example",
    );
    expect(JSON.stringify(c)).not.toContain(SECRET);
    expect(inspect(c)).not.toContain(SECRET);
    expect(JSON.stringify(describeMediaConfig(c))).not.toContain(SECRET);
    expect(c?.apiSecret.expose()).toBe(SECRET);
  });
});
