import { describe, expect, test } from "bun:test";
import { REDACTED_SEGMENT, redactPath, redactUrlsInText, safeLogPath } from "./log-path.ts";

const TOKEN = "inv_s3cr3tT0ken";

describe("redactPath", () => {
  test.each([
    [`/join/${TOKEN}`, `/join/${REDACTED_SEGMENT}`],
    [`/api/invites/${TOKEN}`, `/api/invites/${REDACTED_SEGMENT}`],
    [`/api/join/${TOKEN}`, `/api/join/${REDACTED_SEGMENT}`],
    [`/join/${TOKEN}/extra`, `/join/${REDACTED_SEGMENT}/${REDACTED_SEGMENT}`],
    [`/JOIN/${TOKEN}`, `/JOIN/${REDACTED_SEGMENT}`],
    [`/%6Aoin/${TOKEN}`, `/%6Aoin/${REDACTED_SEGMENT}`],
    [`//join//${TOKEN}`, `//join//${REDACTED_SEGMENT}`],
  ])("%s -> %s", (input, expected) => {
    expect(redactPath(input)).toBe(expected);
  });

  test("leaves ordinary paths alone", () => {
    expect(redactPath("/")).toBe("/");
    expect(redactPath("/join")).toBe("/join");
    expect(redactPath("/office/floor-2")).toBe("/office/floor-2");
    expect(redactPath("/assets/joinery.png")).toBe("/assets/joinery.png");
  });

  test("drops query strings and fragments", () => {
    expect(redactPath("/api/auth/callback/github?code=abc&state=xyz")).toBe(
      "/api/auth/callback/github",
    );
    expect(redactPath(`/join/${TOKEN}#frag`)).toBe(`/join/${REDACTED_SEGMENT}`);
  });

  test("caps very long paths", () => {
    const out = redactPath(`/${"a".repeat(5000)}`);
    expect(out.length).toBeLessThan(210);
  });
});

describe("safeLogPath", () => {
  test("uses the route pattern for routed requests", () => {
    const url = new URL(`http://x/api/join/${TOKEN}?code=1`);
    expect(safeLogPath(url, "/api/join/:token")).toBe("/api/join/:token");
  });

  test("redacts the path for non-pattern labels", () => {
    const url = new URL(`http://x/join/${TOKEN}?code=1`);
    for (const label of ["static", "rooms", "ws", "405", "error", undefined]) {
      expect(safeLogPath(url, label)).toBe(`/join/${REDACTED_SEGMENT}`);
    }
  });
});

describe("redactUrlsInText", () => {
  test("strips queries and invite tokens from absolute and relative URLs", () => {
    const text = `Invalid redirect URL: https://evil.example/cb?code=abc&state=xyz; also http://localhost:3000/join/${TOKEN} and /api/invites/${TOKEN}?a=1`;
    const out = redactUrlsInText(text);
    expect(out).not.toContain("code=");
    expect(out).not.toContain("xyz");
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("https://evil.example/cb?[redacted]");
    expect(out).toContain(`http://localhost:3000/join/${REDACTED_SEGMENT}`);
    expect(out).toContain(`/api/invites/${REDACTED_SEGMENT}?[redacted]`);
  });

  test("leaves text without URLs unchanged", () => {
    expect(redactUrlsInText("Base URL is not set; 1/2 and a/b")).toBe(
      "Base URL is not set; 1/2 and a/b",
    );
  });
});
