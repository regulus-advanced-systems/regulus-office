import { describe, expect, test } from "bun:test";
import { checkOrigin, originPolicyFor } from "./origin.ts";

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

  test("local dev origins match any port only when allowed", () => {
    const dev = originPolicyFor("http://localhost:4600", false);
    const prod = originPolicyFor("http://localhost:4600", true);
    expect(checkOrigin(req("http://localhost:5173"), dev.publicUrl, dev).ok).toBe(true);
    expect(checkOrigin(req("http://127.0.0.1:4600"), dev.publicUrl, dev).ok).toBe(true);
    expect(checkOrigin(req("https://localhost:5173"), dev.publicUrl, dev).ok).toBe(false);
    expect(checkOrigin(req("http://localhost.evil.com"), dev.publicUrl, dev).ok).toBe(false);
    expect(checkOrigin(req("http://localhost:5173"), prod.publicUrl, prod).ok).toBe(false);
    expect(checkOrigin(req("http://localhost:4600"), prod.publicUrl, prod).ok).toBe(true);
    expect(checkOrigin(req("not a url"), "nonsense", dev)).toMatchObject({ reason: "malformed" });
  });

  test("extra allowed origins (dev servers) are honoured", () => {
    const opts = { allowedOrigins: ["http://localhost:5173/"] };
    expect(checkOrigin(req("http://localhost:5173"), PUBLIC, opts).ok).toBe(true);
    expect(checkOrigin(req("http://localhost:5174"), PUBLIC, opts).ok).toBe(false);
  });
});
