import { describe, expect, test } from "bun:test";
import { checkOrigin } from "./origin.ts";

const PUBLIC = "https://office.example.com/";
const req = (origin?: string) =>
  new Request("https://office.example.com/rooms", {
    headers: origin === undefined ? {} : { origin },
  });

describe("checkOrigin", () => {
  test("accepts the public origin regardless of path or trailing slash", () => {
    expect(checkOrigin(req("https://office.example.com"), PUBLIC)).toEqual({
      ok: true,
      origin: "https://office.example.com",
    });
    expect(
      checkOrigin(req("https://office.example.com"), "https://office.example.com/app").ok,
    ).toBe(true);
  });

  test("rejects a mismatched, malformed or null origin", () => {
    expect(checkOrigin(req("https://evil.example"), PUBLIC)).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
    expect(checkOrigin(req("http://office.example.com"), PUBLIC)).toMatchObject({
      reason: "mismatch",
    });
    expect(checkOrigin(req("https://office.example.com:8443"), PUBLIC)).toMatchObject({
      reason: "mismatch",
    });
    expect(checkOrigin(req("not a url"), PUBLIC)).toMatchObject({ ok: false, reason: "malformed" });
    expect(checkOrigin(req("null"), PUBLIC)).toMatchObject({ ok: false, reason: "malformed" });
  });

  test("missing Origin passes by default and fails when required", () => {
    expect(checkOrigin(req(), PUBLIC)).toEqual({ ok: true, origin: null });
    expect(checkOrigin(req(), PUBLIC, { requireOrigin: true })).toMatchObject({
      ok: false,
      reason: "missing",
    });
  });

  test("extra allowed origins (dev servers) are honoured", () => {
    const opts = { allowedOrigins: ["http://localhost:5173/"] };
    expect(checkOrigin(req("http://localhost:5173"), PUBLIC, opts).ok).toBe(true);
    expect(checkOrigin(req("http://localhost:5174"), PUBLIC, opts).ok).toBe(false);
  });
});
