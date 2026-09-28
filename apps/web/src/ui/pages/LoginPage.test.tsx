import { beforeEach, describe, expect, test } from "bun:test";
import { useSessionStore } from "../../state/session.ts";
import { useDom } from "../a11y/dom.ts";
import { type FakeHandler, fakeFetch } from "../auth/fakeFetch.ts";
import { button, location, renderAt, submit, text, typeInto } from "../auth/testDom.tsx";
import { LoginPage } from "./LoginPage.tsx";

useDom();

const OWNER = { id: "u1", displayName: "Ante", role: "owner" };
const routes = [
  { path: "/login", element: <LoginPage /> },
  { path: "/office", element: <p>OFFICE</p> },
];

/** Server double: /api/me answers 401 until a sign-in/up succeeded. */
function server(config: object, signIn?: FakeHandler) {
  let signedIn = false;
  const ok: FakeHandler = () => {
    signedIn = true;
    return { body: { user: {} } };
  };
  return fakeFetch({
    "GET /api/auth-config": { body: config },
    "GET /api/me": () => (signedIn ? { body: OWNER } : { status: 401 }),
    "POST /api/auth/sign-up/email": ok,
    "POST /api/auth/sign-in/email": (c) => {
      const r = signIn?.(c);
      if (r) return r;
      return ok(c);
    },
  });
}

describe("/login", () => {
  beforeEach(() => useSessionStore.setState({ status: "unknown", user: null, error: null }));

  test("an empty office offers the owner account and registers it", async () => {
    const f = server({ hasUsers: false, githubEnabled: false, openSignup: false });
    const m = await renderAt("/login", f.fetch, routes);
    expect(text()).toContain("Set up your office");
    expect(button("Sign in with GitHub")).toBeUndefined();
    await typeInto("Display name", "Ante");
    await typeInto("Email", "ante@example.com");
    await typeInto("Password", "correct horse");
    await typeInto("Confirm password", "correct horse");
    await submit("Create the owner account");
    const signUp = f.calls.find((c) => c.path === "/api/auth/sign-up/email");
    expect(signUp?.body).toEqual({
      name: "Ante",
      email: "ante@example.com",
      password: "correct horse",
    });
    expect(location()).toBe("/office");
    expect(useSessionStore.getState().user).toEqual(OWNER as never);
    await m.unmount();
  });

  test("validation errors block the request and are announced on the fields", async () => {
    const f = server({ hasUsers: false, githubEnabled: false, openSignup: false });
    const m = await renderAt("/login", f.fetch, routes);
    await typeInto("Display name", "Ante");
    await typeInto("Email", "not-an-email");
    await typeInto("Password", "short");
    await typeInto("Confirm password", "other");
    await submit("Create the owner account");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
    expect(text()).toContain("Enter a valid email address.");
    expect(text()).toContain("Use at least 8 characters.");
    expect(text()).toContain("The passwords do not match.");
    expect(document.querySelectorAll('[aria-invalid="true"]').length).toBe(3);
    await m.unmount();
  });

  test("bootstrapped office: sign in, wrong password shows an error, right one enters", async () => {
    let attempts = 0;
    const f = server({ hasUsers: true, githubEnabled: true, openSignup: false }, () => {
      attempts += 1;
      return attempts === 1
        ? { status: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD" } }
        : undefined;
    });
    const m = await renderAt("/login", f.fetch, routes);
    expect(text()).toContain("Sign in");
    expect(text()).not.toContain("owner account");
    expect(text()).toContain("Ask an owner or admin for an invite link");
    expect(button("Sign in with GitHub")).toBeDefined();
    await typeInto("Email", "ante@example.com");
    await typeInto("Password", "wrong");
    await submit("Sign in");
    expect(document.querySelector("[role=alert]")?.textContent).toBe(
      "Email or password is incorrect.",
    );
    expect(location()).toBe("/login");
    await typeInto("Password", "right password");
    await submit("Sign in");
    expect(location()).toBe("/office");
    await m.unmount();
  });

  test("once the owner exists there is no registration form, only the invite hint", async () => {
    const f = server({ hasUsers: true, githubEnabled: false, openSignup: true });
    const m = await renderAt("/login", f.fetch, routes);
    expect(document.querySelectorAll("form").length).toBe(1);
    expect(document.querySelector('form[aria-label="Sign in"]')).not.toBeNull();
    expect(text()).toContain("Ask an owner or admin for an invite link");
    expect(button("Sign in with GitHub")).toBeUndefined();
    await m.unmount();
  });

  test("already signed in: straight to /office", async () => {
    useSessionStore.setState({ status: "authenticated", user: OWNER as never });
    const f = server({ hasUsers: true, githubEnabled: false, openSignup: false });
    const m = await renderAt("/login", f.fetch, routes);
    expect(location()).toBe("/office");
    await m.unmount();
  });
});
