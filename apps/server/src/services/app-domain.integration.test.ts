/**
 * App domain mode (#39): the office path hands out a one-time ticket, the app
 * host swaps it for its own cookie, and the app is served at `/` on its own
 * origin. Floor members who do not own the robot watch it read-only: GET and
 * HEAD, and WebSocket frames from the app only.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { servicesProxyPath } from "@regulus/protocol";
import {
  FakeRunner,
  type ServicesOffice,
  startServicesOffice,
  startUpstream,
} from "./test-helpers.ts";

describe("services proxy, app domain mode", () => {
  let office: ServicesOffice;
  let upstream: ReturnType<typeof startUpstream>;
  const runner = new FakeRunner("linux-user");
  let owner: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let appHost: string;
  let appOrigin: string;

  const onOffice = (path: string, cookie?: string, init: RequestInit = {}) =>
    fetch(new URL(path, office.server.url), {
      redirect: "manual",
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string>) },
    });
  /** A request to the app host, sent to the office's address (no DNS in tests). */
  const onApp = (path: string, cookie?: string, init: RequestInit = {}) =>
    fetch(new URL(path, office.server.url), {
      redirect: "manual",
      ...init,
      headers: {
        host: appHost,
        ...(cookie ? { cookie } : {}),
        ...(init.headers as Record<string, string>),
      },
    });

  /** Office → ticket → app cookie, as a browser would follow it. */
  const openApp = async (officeCookie: string, rest = "") => {
    const first = await onOffice(
      `${servicesProxyPath("f1", "a1", upstream.port)}${rest}`,
      officeCookie,
    );
    expect(first.status).toBe(302);
    const to = new URL(first.headers.get("location") ?? "");
    expect(to.origin).toBe(appOrigin);
    const swap = await onApp(`${to.pathname}${to.search}`);
    expect(swap.status).toBe(302);
    const cookie = swap.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie.startsWith("office.app=")).toBe(true);
    return {
      cookie,
      ticketUrl: `${to.pathname}${to.search}`,
      location: swap.headers.get("location"),
    };
  };

  beforeAll(async () => {
    upstream = startUpstream();
    office = await startServicesOffice({ runner: runner.asRunner(), appDomain: "apps.test" });
    owner = await office.signUp("Owner");
    viewer = await office.signUp("Viewer", "viewer");
    outsider = await office.signUp("Outsider");
    office.addFloor("f1", { [owner.id]: "spawn", [viewer.id]: "view" });
    office.addAgent("a1", "f1", owner.id);
    runner.ports.set("a1", [{ port: upstream.port, address: "0.0.0.0", pid: 10 }]);
    await office.scanner.tick();
    appHost = `${upstream.port}-a1.apps.test:${office.server.port}`;
    appOrigin = `http://${appHost}`;
  });

  afterAll(async () => {
    await office?.stop();
    upstream?.server.stop(true);
  });

  test("apps are marked shared", () => {
    const [svc] = office.published.get("f1") as { shared: boolean }[];
    expect(svc?.shared).toBe(true);
  });

  test("the owner opens the app on its own origin, served at /", async () => {
    const { cookie, location } = await openApp(owner.cookie, "deep?x=1");
    expect(location).toBe("/deep?x=1");
    // Even if the office cookie reached the app host, it would not reach the app.
    const res = await onApp("/deep?x=1", `${cookie}; ${owner.cookie}; mine=1`);
    expect(res.status).toBe(200);
    const seen = upstream.seen.at(-1);
    expect(seen?.path).toBe("/deep?x=1");
    expect(seen?.headers.cookie).toBe("mine=1");
    expect(seen?.headers["x-forwarded-prefix"]).toBeUndefined();
    const post = await onApp("/save", cookie, {
      method: "POST",
      body: "x",
      headers: { origin: appOrigin },
    });
    expect(post.status).toBe(200);
  });

  test("a floor viewer watches read-only", async () => {
    const { cookie } = await openApp(viewer.cookie);
    expect((await onApp("/", cookie)).status).toBe(200);
    expect((await onApp("/", cookie, { method: "HEAD" })).status).toBe(200);
    const post = await onApp("/save", cookie, {
      method: "POST",
      body: "x",
      headers: { origin: appOrigin },
    });
    expect(post.status).toBe(405);
  });

  test("tickets are single-use, cookies are bound to their app", async () => {
    const { cookie, ticketUrl } = await openApp(owner.cookie);
    expect((await onApp(ticketUrl)).status).toBe(403);
    // The same cookie on another port's host is not valid there.
    const other = await fetch(new URL("/", office.server.url), {
      redirect: "manual",
      headers: { host: `1-a1.apps.test:${office.server.port}`, cookie },
    });
    expect(other.status).toBe(401);
    // No cookie: back through the office.
    const bounce = await onApp("/page");
    expect(bounce.status).toBe(302);
    expect(bounce.headers.get("location")).toBe(
      new URL(`${servicesProxyPath("f1", "a1", upstream.port)}page`, office.server.url).toString(),
    );
    // A forged cookie.
    expect((await onApp("/", "office.app=eyJrIjoiYyJ9.bad", { method: "POST" })).status).toBe(401);
  });

  test("the office path only redirects: no app content on the office origin", async () => {
    const post = await onOffice(servicesProxyPath("f1", "a1", upstream.port), owner.cookie, {
      method: "POST",
      body: "x",
      headers: { origin: office.origin },
    });
    expect(post.status).toBe(404);
    const outsiderRes = await onOffice(
      servicesProxyPath("f1", "a1", upstream.port),
      outsider.cookie,
    );
    expect(outsiderRes.status).toBe(404);
  });

  const wsOpen = (cookie: string, origin: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${office.server.port}/hmr`, {
      headers: { host: appHost, cookie, origin },
    } as unknown as string[]);
    const got: string[] = [];
    ws.onmessage = (e) => got.push(String(e.data));
    const opened = new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
    });
    return { ws, got, opened };
  };

  test("WebSocket: the owner talks to the app, a watcher only listens", async () => {
    const own = wsOpen((await openApp(owner.cookie)).cookie, appOrigin);
    const watch = wsOpen((await openApp(viewer.cookie)).cookie, appOrigin);
    await Promise.all([own.opened, watch.opened]);
    await Bun.sleep(100);
    own.ws.send("a");
    watch.ws.send("b");
    await Bun.sleep(300);
    expect(own.got).toEqual(["hello from app", "echo:a"]);
    expect(watch.got).toEqual(["hello from app"]);
    own.ws.close();
    watch.ws.close();
  });

  test("a cross-origin WebSocket to the app host is refused", async () => {
    const { cookie } = await openApp(owner.cookie);
    const res = await onApp("/hmr", cookie, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        origin: office.origin,
      },
    });
    expect(res.status).toBe(403);
  });
});
