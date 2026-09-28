import { beforeEach, describe, expect, test } from "bun:test";
import { useSessionStore } from "../../state/session.ts";
import { useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, location, renderAt, submit, text, typeInto } from "../auth/testDom.tsx";
import { JoinPage } from "./JoinPage.tsx";

useDom();

const MIRA = { id: "u2", displayName: "Mira", role: "admin" };
const routes = [
  { path: "/join/:token", element: <JoinPage /> },
  { path: "/login", element: <p>LOGIN</p> },
  { path: "/office", element: <p>OFFICE</p> },
];

describe("/join/:token", () => {
  beforeEach(() => useSessionStore.setState({ status: "unknown", user: null, error: null }));

  test("shows the invite's role and expiry, registers through /api/join and enters", async () => {
    let joined = false;
    const f = fakeFetch({
      "GET /api/me": () => (joined ? { body: MIRA } : { status: 401 }),
      "GET /api/invites/tok123": { body: { role: "admin", expiresAt: "2026-10-05T12:00:00.000Z" } },
      "POST /api/join/tok123": () => {
        joined = true;
        return { status: 201, body: MIRA };
      },
    });
    const m = await renderAt("/join/tok123", f.fetch, routes);
    expect(text()).toContain("Join this office as an admin");
    expect(text()).toContain("2026");
    await typeInto("Display name", "Mira");
    await typeInto("Email", "mira@example.com");
    await typeInto("Password", "12345678");
    await typeInto("Confirm password", "12345678");
    await submit("Create account and join");
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Mira",
      email: "mira@example.com",
      password: "12345678",
    });
    expect(location()).toBe("/office");
    expect(useSessionStore.getState().user?.role).toBe("admin");
    await m.unmount();
  });

  for (const [reason, wording] of [
    ["expired", "has expired"],
    ["used", "already been used"],
    ["not_found", "not valid"],
  ] as const) {
    test(`a ${reason} invite shows a clear error and no form`, async () => {
      const f = fakeFetch({
        "GET /api/me": { status: 401 },
        "GET /api/invites/bad": { status: 404, body: { error: "invite_invalid", reason } },
      });
      const m = await renderAt("/join/bad", f.fetch, routes);
      expect(text()).toContain("Invite not usable");
      expect(document.querySelector("[role=alert]")?.textContent).toContain(wording);
      expect(document.querySelector("form")).toBeNull();
      await m.unmount();
    });
  }

  test("an invite lost to a race after the form was shown reports it", async () => {
    const f = fakeFetch({
      "GET /api/me": { status: 401 },
      "GET /api/invites/tok": { body: { role: "member", expiresAt: "2026-10-05T12:00:00.000Z" } },
      "POST /api/join/tok": { status: 409, body: { error: "invite_invalid", reason: "used" } },
    });
    const m = await renderAt("/join/tok", f.fetch, routes);
    await typeInto("Display name", "Mira");
    await typeInto("Email", "mira@example.com");
    await typeInto("Password", "12345678");
    await typeInto("Confirm password", "12345678");
    await submit("Create account and join");
    expect(document.querySelector("[role=alert]")?.textContent).toContain("already been used");
    expect(location()).toBe("/join/tok");
    await m.unmount();
  });

  test("a signed-in visitor is told to sign out first", async () => {
    const f = fakeFetch({
      "GET /api/me": { body: MIRA },
      "GET /api/invites/tok": { body: { role: "member", expiresAt: "2026-10-05T12:00:00.000Z" } },
    });
    const m = await renderAt("/join/tok", f.fetch, routes);
    expect(text()).toContain("You are signed in as Mira");
    expect(button("Sign out")).toBeDefined();
    expect(document.querySelector("form")).toBeNull();
    await m.unmount();
  });
});
