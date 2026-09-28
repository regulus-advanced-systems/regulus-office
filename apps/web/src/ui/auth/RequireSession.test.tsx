import { beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { click, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "./fakeFetch.ts";
import { RequireSession } from "./RequireSession.tsx";
import { button, location, renderAt, settle, text } from "./testDom.tsx";

useDom();

const routes = [
  { path: "/login", element: <p>LOGIN PAGE</p> },
  {
    path: "/office",
    element: (
      <RequireSession>
        <p>OFFICE CONTENT</p>
      </RequireSession>
    ),
  },
];

describe("RequireSession", () => {
  beforeEach(() => useSessionStore.setState({ status: "unknown", user: null, error: null }));

  test("anonymous visitors are sent to /login and the office never renders", async () => {
    const f = fakeFetch({ "GET /api/me": { status: 401, body: { error: "unauthorized" } } });
    const m = await renderAt("/office", f.fetch, routes);
    expect(location()).toBe("/login");
    expect(text()).toContain("LOGIN PAGE");
    expect(text()).not.toContain("OFFICE CONTENT");
    await m.unmount();
  });

  test("children mount only after /api/me confirms the session", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = (async () => {
      await gate;
      return new Response(JSON.stringify({ id: "u1", displayName: "Ante", role: "owner" }));
    }) as unknown as typeof fetch;
    const m = await renderAt("/office", slow, routes);
    expect(text()).toContain("Checking your session");
    expect(text()).not.toContain("OFFICE CONTENT");
    release();
    await settle();
    expect(text()).toContain("OFFICE CONTENT");
    expect(location()).toBe("/office");
    await m.unmount();
  });

  test("a server failure offers a retry instead of redirecting", async () => {
    let up = false;
    const f = fakeFetch({
      "GET /api/me": () =>
        up ? { body: { id: "u1", displayName: "Ante", role: "member" } } : { status: 503 },
    });
    const m = await renderAt("/office", f.fetch, routes);
    expect(text()).toContain("Can't reach the office");
    expect(location()).toBe("/office");
    up = true;
    await click(button("Try again") as HTMLElement);
    await settle();
    expect(text()).toContain("OFFICE CONTENT");
    await m.unmount();
  });

  test("signing out while inside redirects to /login", async () => {
    const f = fakeFetch({
      "GET /api/me": { body: { id: "u1", displayName: "Ante", role: "owner" } },
    });
    const m = await renderAt("/office", f.fetch, routes);
    expect(text()).toContain("OFFICE CONTENT");
    await act(async () => useSessionStore.getState().clear());
    expect(location()).toBe("/login");
    await m.unmount();
  });
});
