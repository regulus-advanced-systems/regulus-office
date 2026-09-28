import { beforeEach, describe, expect, test } from "bun:test";
import { parseSessionUser, SESSION_ENDPOINT, useSessionStore } from "./session.ts";

const respond = (status: number, body?: unknown): typeof fetch =>
  (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

describe("session store", () => {
  beforeEach(() => useSessionStore.setState({ status: "unknown", user: null, error: null }));

  test("404 (auth not implemented yet) and 401 mean anonymous, not error", async () => {
    await useSessionStore.getState().fetchSession(respond(404));
    expect(useSessionStore.getState().status).toBe("anonymous");
    await useSessionStore.getState().fetchSession(respond(401));
    expect(useSessionStore.getState().status).toBe("anonymous");
  });

  test("authenticated user is picked out of the response", async () => {
    await useSessionStore
      .getState()
      .fetchSession(respond(200, { user: { id: "u1", displayName: "Ante", role: "owner" } }));
    expect(useSessionStore.getState()).toMatchObject({
      status: "authenticated",
      user: { id: "u1", displayName: "Ante", role: "owner" },
    });
  });

  test("network failure and 5xx are reported as error with a message", async () => {
    await useSessionStore.getState().fetchSession(respond(500));
    expect(useSessionStore.getState().status).toBe("error");
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await useSessionStore.getState().fetchSession(boom);
    expect(useSessionStore.getState()).toMatchObject({ status: "error", error: "offline" });
  });

  test("parseSessionUser tolerates unknown roles and missing names", () => {
    expect(parseSessionUser({ user: { id: "u2", name: "N", role: "root" } })).toEqual({
      id: "u2",
      displayName: "N",
      role: "viewer",
    });
    expect(parseSessionUser({ user: { id: "u3" } })?.displayName).toBe("u3");
    expect(parseSessionUser({})).toBeNull();
    expect(parseSessionUser(null)).toBeNull();
  });

  test("hits the documented endpoint with same-origin credentials", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const spy = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    await useSessionStore.getState().fetchSession(spy);
    expect(seen).toMatchObject({ url: SESSION_ENDPOINT, init: { credentials: "same-origin" } });
  });
});
