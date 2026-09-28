/**
 * The web client's auth API (apps/web/src/ui/auth/api.ts) against a real
 * office-server on port 0 with invite-only sign-up: owner bootstrap, invite,
 * join, sign-out. A tiny cookie jar stands in for the browser.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startOffice } from "../../apps/server/src/auth/test-helpers.ts";
import { createAuthApi } from "../../apps/web/src/ui/auth/api.ts";

type Office = ReturnType<typeof startOffice>;
let office: Office;

/** A browser in miniature: keeps cookies per origin and sends the page Origin. */
function browser(origin: string) {
  const jar = new Map<string, string>();
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", origin);
    if (jar.size > 0) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(input, { ...init, headers });
    for (const c of res.headers.getSetCookie()) {
      const [pair = ""] = c.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/max-age=0/i.test(c) || value === "") jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }) as typeof fetch;
  return { api: createAuthApi({ fetch: fetchFn, baseUrl: origin }), jar };
}

beforeAll(() => {
  office = startOffice({ openSignup: false });
});
afterAll(() => office.stop());

describe("web auth client against a real server", () => {
  test("owner bootstrap, invite, join and sign-out", async () => {
    const ante = browser(office.origin);
    const mira = browser(office.origin);

    expect(await ante.api.getConfig()).toEqual({
      ok: true,
      data: { hasUsers: false, githubEnabled: false, openSignup: false },
    });
    expect(await ante.api.me()).toMatchObject({ ok: false, status: 401, code: "unauthorized" });

    const owner = { name: "Ante", email: "ante@example.com", password: "correct horse battery" };
    expect(await ante.api.signUp(owner)).toEqual({ ok: true, data: true });
    expect(await ante.api.me()).toMatchObject({
      ok: true,
      data: { displayName: "Ante", role: "owner" },
    });
    expect(await ante.api.getConfig()).toMatchObject({ ok: true, data: { hasUsers: true } });

    // Invite-only after bootstrap: a direct sign-up is refused.
    const miraAccount = { name: "Mira", email: "mira@example.com", password: "another good one" };
    expect(await mira.api.signUp(miraAccount)).toMatchObject({ ok: false, code: "signup_closed" });

    const invite = await ante.api.createInvite("admin");
    if (!invite.ok) throw new Error(`invite failed: ${invite.code}`);
    expect(invite.data.url).toBe(`${office.origin}/join/${invite.data.url.split("/join/")[1]}`);
    const token = decodeURIComponent(invite.data.url.split("/join/")[1] ?? "");

    expect(await mira.api.getInvite(token)).toEqual({
      ok: true,
      data: { role: "admin", expiresAt: invite.data.expiresAt },
    });
    expect(await mira.api.join(token, miraAccount)).toMatchObject({
      ok: true,
      data: { displayName: "Mira", role: "admin" },
    });
    expect(await mira.api.me()).toMatchObject({ ok: true, data: { role: "admin" } });

    // Single use.
    expect(await browser(office.origin).api.getInvite(token)).toMatchObject({
      ok: false,
      code: "invite_invalid",
      reason: "used",
    });

    // Signing in again works; signing out ends the session.
    expect(await mira.api.signOut()).toEqual({ ok: true, data: true });
    expect(await mira.api.me()).toMatchObject({ ok: false, status: 401 });
    expect(
      await mira.api.signIn({ email: miraAccount.email, password: "wrong password" }),
    ).toMatchObject({ ok: false, code: "invalid_email_or_password" });
    expect(await mira.api.signIn(miraAccount)).toEqual({ ok: true, data: true });
    expect(await mira.api.me()).toMatchObject({ ok: true, data: { displayName: "Mira" } });
  });
});
