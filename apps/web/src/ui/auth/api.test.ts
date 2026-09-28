import { describe, expect, test } from "bun:test";
import { createAuthApi, describeAuthError, describeInviteRejection } from "./api.ts";
import { fakeFetch } from "./fakeFetch.ts";

const INVITE = { role: "member" as const, expiresAt: "2026-10-05T12:00:00.000Z" };

describe("auth API client", () => {
  test("posts credentials as JSON with same-origin cookies to Better Auth", async () => {
    const f = fakeFetch({
      "POST /api/auth/sign-in/email": { body: { token: "session-token-in-body", user: {} } },
      "POST /api/auth/sign-up/email": { body: { user: {} } },
      "POST /api/auth/sign-out": { body: { success: true } },
    });
    const api = createAuthApi({ fetch: f.fetch });
    const signIn = await api.signIn({ email: "a@b.co", password: "pw" });
    // Only a boolean comes back: tokens in the body never reach the UI.
    expect(signIn).toEqual({ ok: true, data: true });
    await api.signUp({ name: "Ante", email: "a@b.co", password: "12345678" });
    await api.signOut();
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/auth/sign-in/email",
      "POST /api/auth/sign-up/email",
      "POST /api/auth/sign-out",
    ]);
    expect(f.calls[0]?.body).toEqual({ email: "a@b.co", password: "pw" });
    expect(f.calls[1]?.body).toEqual({ name: "Ante", email: "a@b.co", password: "12345678" });
    for (const c of f.calls) expect(c.init?.credentials).toBe("same-origin");
  });

  test("reads the public auth config, defaulting unknown flags to false", async () => {
    const f = fakeFetch({
      "GET /api/auth-config": { body: { hasUsers: true, githubEnabled: "yes" } },
    });
    expect(await createAuthApi({ fetch: f.fetch }).getConfig()).toEqual({
      ok: true,
      data: { hasUsers: true, githubEnabled: false, openSignup: false },
    });
  });

  test("invites: lookup, creation and join with URL-encoded tokens", async () => {
    const f = fakeFetch({
      "GET /api/invites/a%2Fb": { body: INVITE },
      "POST /api/invites": {
        status: 201,
        body: { ...INVITE, id: "i1", token: "t", url: "http://x/join/t" },
      },
      "POST /api/join/a%2Fb": {
        status: 201,
        body: { id: "u2", displayName: "Mira", role: "member" },
      },
    });
    const api = createAuthApi({ fetch: f.fetch });
    expect(await api.getInvite("a/b")).toEqual({ ok: true, data: INVITE });
    expect(await api.createInvite("member")).toEqual({
      ok: true,
      data: { ...INVITE, id: "i1", url: "http://x/join/t" },
    });
    expect(f.calls[1]?.body).toEqual({ role: "member" });
    expect(await api.join("a/b", { name: "Mira", email: "m@b.co", password: "12345678" })).toEqual({
      ok: true,
      data: { id: "u2", displayName: "Mira", role: "member" },
    });
  });

  test("GitHub sign-in returns the provider URL and asks to come back to /office", async () => {
    const f = fakeFetch({
      "POST /api/auth/sign-in/social": {
        body: { url: "https://github.com/login/oauth", redirect: true },
      },
    });
    expect(await createAuthApi({ fetch: f.fetch }).githubSignIn()).toEqual({
      ok: true,
      data: "https://github.com/login/oauth",
    });
    expect(f.calls[0]?.body).toMatchObject({ provider: "github", callbackURL: "/office" });
  });

  test("normalises Better Auth and office error bodies", async () => {
    const f = fakeFetch({
      "POST /api/auth/sign-in/email": { status: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD" } },
      "GET /api/invites/old": { status: 404, body: { error: "invite_invalid", reason: "expired" } },
      "POST /api/invites": { status: 429, body: { error: "rate_limited", retryAfterSeconds: 12 } },
      "GET /api/auth-config": { status: 502 },
    });
    const api = createAuthApi({ fetch: f.fetch });
    expect(await api.signIn({ email: "a@b.co", password: "x" })).toEqual({
      ok: false,
      status: 401,
      code: "invalid_email_or_password",
    });
    expect(await api.getInvite("old")).toEqual({
      ok: false,
      status: 404,
      code: "invite_invalid",
      reason: "expired",
    });
    expect(await api.createInvite("admin")).toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 12,
    });
    expect(await api.getConfig()).toMatchObject({ ok: false, code: "http_502" });
  });

  test("network failures and malformed bodies become results, not throws", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await createAuthApi({ fetch: offline }).me()).toEqual({
      ok: false,
      status: 0,
      code: "network_error",
    });
    const junk = fakeFetch({ "GET /api/invites/x": { body: { role: "root" } } });
    expect(await createAuthApi({ fetch: junk.fetch }).getInvite("x")).toMatchObject({
      ok: false,
      code: "bad_response",
    });
  });

  test("baseUrl prefixes every path", async () => {
    const seen: string[] = [];
    const spy = (async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await createAuthApi({ fetch: spy, baseUrl: "http://office:4600/" }).getConfig();
    expect(seen).toEqual(["http://office:4600/api/auth-config"]);
  });

  test("error wording covers the cases the pages show", () => {
    const e = (code: string, extra: object = {}) =>
      describeAuthError({ ok: false, status: 400, code, ...extra });
    expect(e("invalid_email_or_password")).toBe("Email or password is incorrect.");
    expect(e("signup_closed")).toContain("invite only");
    expect(e("user_already_exists_use_another_email")).toContain("already exists");
    expect(e("rate_limited", { retryAfterSeconds: 30 })).toContain("30 seconds");
    expect(e("invite_invalid", { reason: "used" })).toContain("already been used");
    expect(describeInviteRejection("expired")).toContain("expired");
    expect(describeInviteRejection("not_found")).toContain("not valid");
    expect(describeAuthError({ ok: false, status: 503, code: "http_503" })).toContain("server");
  });
});
