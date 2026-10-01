import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_GENIUS_LOOK } from "@regulus/protocol/src/genius.ts";
import { canManageOffice, parseSessionUser, SESSION_ENDPOINT, useSessionStore } from "./session.ts";

const respond = (status: number, body?: unknown): typeof fetch =>
  (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

const ME = { id: "u1", displayName: "Ante", role: "owner" };
const reset = () => useSessionStore.setState({ status: "unknown", user: null, error: null });

describe("session store (/api/me)", () => {
  beforeEach(reset);

  test("401 means anonymous, not error", async () => {
    await useSessionStore.getState().fetchSession(respond(401, { error: "unauthorized" }));
    expect(useSessionStore.getState()).toMatchObject({ status: "anonymous", user: null });
  });

  test("the /api/me body becomes the session user", async () => {
    await useSessionStore.getState().fetchSession(respond(200, ME));
    expect(useSessionStore.getState()).toMatchObject({ status: "authenticated", user: ME });
  });

  test("network failure and 5xx are errors when nobody is known yet", async () => {
    await useSessionStore.getState().fetchSession(respond(500));
    expect(useSessionStore.getState().status).toBe("error");
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await useSessionStore.getState().fetchSession(boom);
    expect(useSessionStore.getState()).toMatchObject({ status: "error", error: "offline" });
  });

  test("a refresh keeps the user through transient failures but drops them on 401", async () => {
    await useSessionStore.getState().fetchSession(respond(200, ME));
    const seen: string[] = [];
    const unsub = useSessionStore.subscribe((s) => seen.push(s.status));
    await useSessionStore.getState().fetchSession(respond(503));
    expect(useSessionStore.getState()).toMatchObject({ status: "authenticated", user: ME });
    expect(seen).not.toContain("loading");
    await useSessionStore.getState().fetchSession(respond(401));
    expect(useSessionStore.getState()).toMatchObject({ status: "anonymous", user: null });
    unsub();
  });

  test("concurrent checks share one request", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify(ME), { status: 200 });
    }) as unknown as typeof fetch;
    await Promise.all([
      useSessionStore.getState().fetchSession(counting),
      useSessionStore.getState().fetchSession(counting),
    ]);
    expect(calls).toBe(1);
  });

  test("clear forgets the user", async () => {
    await useSessionStore.getState().fetchSession(respond(200, ME));
    useSessionStore.getState().clear();
    expect(useSessionStore.getState()).toMatchObject({ status: "anonymous", user: null });
  });

  test("parseSessionUser tolerates unknown roles and missing names, rejects junk", () => {
    expect(parseSessionUser({ id: "u2", displayName: "N", role: "root" })).toEqual({
      id: "u2",
      displayName: "N",
      role: "viewer",
    });
    expect(parseSessionUser({ id: "u3" })?.displayName).toBe("u3");
    // The genius (#185): resolved field by field; only an explicit false opens the picker.
    const tycoon = { ...DEFAULT_GENIUS_LOOK, archetype: "tycoon", accessory: "monocle" };
    expect(parseSessionUser({ id: "u4", avatar: tycoon, avatarChosen: false })).toMatchObject({
      avatar: tycoon,
      avatarChosen: false,
    });
    expect(
      parseSessionUser({ id: "u5", avatar: { archetype: "pirate", accessory: "monocle" } }),
    ).toMatchObject({ avatar: DEFAULT_GENIUS_LOOK, avatarChosen: true });
    expect(parseSessionUser({})).toBeNull();
    expect(parseSessionUser(null)).toBeNull();
  });

  test("hits /api/me with same-origin credentials and stores nothing in localStorage", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const spy = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(ME), { status: 200 });
    }) as unknown as typeof fetch;
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem: (k: string, v: string) => store.set(k, v), getItem: () => null },
    });
    try {
      await useSessionStore.getState().fetchSession(spy);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
    expect(SESSION_ENDPOINT).toBe("/api/me");
    expect(seen).toMatchObject({ url: "/api/me", init: { credentials: "same-origin" } });
    expect(store.size).toBe(0);
  });

  test("only owners and admins manage the office", () => {
    expect(canManageOffice("owner")).toBe(true);
    expect(canManageOffice("admin")).toBe(true);
    expect(canManageOffice("member")).toBe(false);
    expect(canManageOffice("viewer")).toBe(false);
    expect(canManageOffice(undefined)).toBe(false);
  });
});
