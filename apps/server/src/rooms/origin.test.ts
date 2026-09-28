import { describe, expect, test } from "bun:test";
import { allowedOriginsFor, isOriginAllowed } from "./origin.ts";

describe("origin check", () => {
  test("production allows only the public origin", () => {
    const allowed = allowedOriginsFor("https://office.example.com/some/path", true);
    expect(allowed).toEqual(["https://office.example.com"]);
    expect(isOriginAllowed("https://office.example.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://evil.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("http://office.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(false);
  });

  test("development also allows local hosts on any port", () => {
    const allowed = allowedOriginsFor("http://localhost:4600", false);
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:4600", allowed)).toBe(true);
    expect(isOriginAllowed("https://localhost:5173", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost.evil.com", allowed)).toBe(false);
  });

  test("a missing origin is allowed; garbage and opaque origins are not", () => {
    const allowed = allowedOriginsFor("https://office.example.com", true);
    expect(isOriginAllowed(null, allowed)).toBe(true);
    expect(isOriginAllowed("", allowed)).toBe(true);
    expect(isOriginAllowed("null", allowed)).toBe(false);
    expect(isOriginAllowed("not a url", allowed)).toBe(false);
  });

  test("an unparsable public url allows nothing in production", () => {
    expect(allowedOriginsFor("nonsense", true)).toEqual([]);
    expect(isOriginAllowed("https://x.example.com", [])).toBe(false);
  });
});
