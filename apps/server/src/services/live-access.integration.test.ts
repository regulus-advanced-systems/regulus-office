/**
 * Lost access closes relayed app WebSockets (#244), in both proxy modes: two
 * humans connected to one henchman's app (its owner and a watcher), access
 * withdrawn from one while the app keeps sending. The browser's socket closes
 * with an `ACCESS_CLOSE_CODES` code, no further app frame reaches it, nothing
 * it sends reaches the app, and the app's own socket for it is closed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ACCESS_CLOSE_CODES, servicesProxyPath } from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { operationMembers, operations, sessions, userProfiles } from "../db/schema/index.ts";
import { FakeRunner, type ServicesOffice, startServicesOffice } from "./test-helpers.ts";

type User = { id: string; cookie: string };

/** A dev server whose WebSocket ticks, so "no further data" is observable. */
function startTicker() {
  const sockets = new Set<{ send(data: string): unknown }>();
  const received: string[] = [];
  let closed = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      if (srv.upgrade(req)) return;
      return new Response("<title>Ticker</title>ok", { headers: { "content-type": "text/html" } });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        ws.send("hello");
      },
      message(_ws, m) {
        received.push(String(m));
      },
      close(ws) {
        sockets.delete(ws);
        closed += 1;
      },
    },
  });
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    for (const ws of sockets) ws.send(`tick ${n}`);
  }, 20);
  return {
    port: server.port as number,
    received,
    get open() {
      return sockets.size;
    },
    get closed() {
      return closed;
    },
    stop() {
      clearInterval(timer);
      server.stop(true);
    },
  };
}

function watch(ws: WebSocket) {
  const got: string[] = [];
  let close: { code: number; reason: string; at: number } | undefined;
  ws.onmessage = (e) => got.push(String(e.data));
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws error"));
  });
  const closed = new Promise<{ code: number; reason: string; at: number }>((resolve) => {
    ws.addEventListener("close", (e) => {
      close = { code: e.code, reason: e.reason, at: Date.now() };
      resolve(close);
    });
  });
  return { ws, got, opened, closed, close: () => close };
}

async function until(check: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

describe("services proxy, path mode: the owner's app socket", () => {
  let office: ServicesOffice;
  let app: ReturnType<typeof startTicker>;
  const runner = new FakeRunner("linux-user");
  let admin: User;
  let owner: User;
  let prefix: string;

  const openApp = (user: User) =>
    watch(
      new WebSocket(
        `${String(office.server.url).replace(/^http/, "ws").replace(/\/$/, "")}${prefix}hmr`,
        { headers: { cookie: user.cookie, origin: office.origin } } as unknown as string[],
      ),
    );

  beforeAll(async () => {
    app = startTicker();
    office = await startServicesOffice({ runner: runner.asRunner() });
    admin = await office.signUp("Admin"); // first account: office owner
    owner = await office.signUp("Rita");
    office.addOperation("f1", { [owner.id]: "spawn" });
    office.addAgent("a1", "f1", owner.id);
    office.addAgent("a2", "f1", admin.id);
    for (const id of ["a1", "a2"]) {
      runner.ports.set(id, [{ port: app.port, address: "127.0.0.1", pid: 10 }]);
      runner.processes.set(id, [{ pid: 10, ppid: 1, command: "node" }]);
    }
    await office.scanner.tick();
    prefix = servicesProxyPath("f1", "a1", app.port);
  });

  afterAll(async () => {
    await office?.stop();
    app?.stop();
  });

  test("removed from the operation: closed, no more frames either way, the app's socket goes too", async () => {
    // Two humans, each on their own henchman's app (path mode is owner only).
    const mine = openApp(owner);
    const other = watch(
      new WebSocket(
        `${String(office.server.url).replace(/^http/, "ws").replace(/\/$/, "")}${servicesProxyPath("f1", "a2", app.port)}hmr`,
        { headers: { cookie: admin.cookie, origin: office.origin } } as unknown as string[],
      ),
    );
    await Promise.all([mine.opened, other.opened]);
    await until(() => mine.got.length > 2 && other.got.length > 2, "ticks");
    expect(app.open).toBe(2);

    office.db
      .delete(operationMembers)
      .where(and(eq(operationMembers.operationId, "f1"), eq(operationMembers.userId, owner.id)))
      .run();
    const at = Date.now();
    expect(office.liveAccess.accessChanged({ userId: owner.id, operationIds: ["f1"] })).toEqual({
      checked: 1,
      ended: 1,
    });
    const close = await mine.closed;
    expect(close.code).toBe(ACCESS_CLOSE_CODES.revoked);
    expect(close.reason).toBe("access revoked");
    expect(close.at - at).toBeLessThan(1000);

    const seen = mine.got.length;
    const others = other.got.length;
    await until(() => app.open === 1, "the app's socket for the removed human");
    await Bun.sleep(200);
    expect(mine.got.length).toBe(seen);
    // The other human's relay is untouched and still ticking.
    expect(other.got.length).toBeGreaterThan(others);
    expect(other.close()).toBeUndefined();
    other.ws.close();
  });
});

describe("services proxy, app domain mode: owner and watcher", () => {
  let office: ServicesOffice;
  let app: ReturnType<typeof startTicker>;
  const runner = new FakeRunner("linux-user");
  let owner: User;
  let watcher: User;
  let appHost: string;
  let appOrigin: string;

  const onOffice = (path: string, cookie: string) =>
    fetch(new URL(path, office.server.url), { redirect: "manual", headers: { cookie } });
  const onApp = (path: string) =>
    fetch(new URL(path, office.server.url), { redirect: "manual", headers: { host: appHost } });

  /** Office → ticket → app cookie → the app's WebSocket, as a browser does it. */
  const openApp = async (user: User) => {
    const first = await onOffice(servicesProxyPath("f1", "a1", app.port), user.cookie);
    const to = new URL(first.headers.get("location") ?? "");
    const swap = await onApp(`${to.pathname}${to.search}`);
    const cookie = swap.headers.get("set-cookie")?.split(";")[0] ?? "";
    const w = watch(
      new WebSocket(`ws://127.0.0.1:${office.server.port}/hmr`, {
        headers: { host: appHost, cookie, origin: appOrigin },
      } as unknown as string[]),
    );
    await w.opened;
    return w;
  };

  beforeAll(async () => {
    app = startTicker();
    office = await startServicesOffice({ runner: runner.asRunner(), appDomain: "apps.test" });
    owner = await office.signUp("Owner");
    watcher = await office.signUp("Wendy");
    office.addOperation("f1", { [owner.id]: "spawn", [watcher.id]: "view" });
    office.addAgent("a1", "f1", owner.id);
    runner.ports.set("a1", [{ port: app.port, address: "0.0.0.0", pid: 10 }]);
    await office.scanner.tick();
    appHost = `${app.port}-a1.apps.test:${office.server.port}`;
    appOrigin = `http://${appHost}`;
  });

  afterAll(async () => {
    await office?.stop();
    app?.stop();
  });

  test("the watcher is removed while both are connected", async () => {
    const own = await openApp(owner);
    const seeing = await openApp(watcher);
    await until(() => own.got.length > 2 && seeing.got.length > 2, "ticks");

    office.db
      .delete(operationMembers)
      .where(and(eq(operationMembers.operationId, "f1"), eq(operationMembers.userId, watcher.id)))
      .run();
    office.liveAccess.accessChanged({ userId: watcher.id, operationIds: ["f1"] });
    expect((await seeing.closed).code).toBe(ACCESS_CLOSE_CODES.revoked);
    const seen = seeing.got.length;
    const ownSeen = own.got.length;
    await Bun.sleep(200);
    expect(seeing.got.length).toBe(seen);
    expect(own.got.length).toBeGreaterThan(ownSeen);
    expect(own.close()).toBeUndefined();
    own.ws.close();
  });

  test("the owner demoted to viewer loses control: closed with `changed`", async () => {
    const own = await openApp(owner);
    own.ws.send("typed-before");
    await until(() => app.received.includes("typed-before"), "the owner's frame at the app");

    office.db
      .update(userProfiles)
      .set({ role: "viewer" })
      .where(eq(userProfiles.userId, owner.id))
      .run();
    office.liveAccess.accessChanged({ userId: owner.id });
    expect((await own.closed).code).toBe(ACCESS_CLOSE_CODES.changed);
    // A fresh socket is a watcher's: frames from the app only.
    const again = await openApp(owner);
    again.ws.send("typed-after");
    await until(() => again.got.length > 2, "ticks for the watcher");
    await Bun.sleep(100);
    expect(app.received).not.toContain("typed-after");
    again.ws.close();
    office.db
      .update(userProfiles)
      .set({ role: "owner" })
      .where(eq(userProfiles.userId, owner.id))
      .run();
  });

  test("signed out everywhere: the app socket (which carries no office session) closes", async () => {
    const own = await openApp(owner);
    await until(() => own.got.length > 1, "ticks");
    office.db.delete(sessions).where(eq(sessions.userId, owner.id)).run();
    office.liveAccess.accessChanged({ userId: owner.id });
    expect((await own.closed).code).toBe(ACCESS_CLOSE_CODES.signedOut);
  });

  test("operation archived: the app closes for everyone", async () => {
    const third = await office.signUp("Tess");
    office.db
      .insert(operationMembers)
      .values({ operationId: "f1", userId: third.id, access: "view" })
      .run();
    const seeing = await openApp(third);
    office.db
      .update(operations)
      .set({ archivedAt: new Date() })
      .where(eq(operations.id, "f1"))
      .run();
    office.liveAccess.accessChanged({ operationIds: ["f1"] });
    expect((await seeing.closed).code).toBe(ACCESS_CLOSE_CODES.revoked);
    await until(() => app.open === 0, "the app's sockets");
  });
});
