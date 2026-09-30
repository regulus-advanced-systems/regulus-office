/**
 * The services proxy in path mode (#39) against a real dev-server double:
 * HTTP and WebSocket through `/p/<floor>/a/<agent>/port/<n>/`, what is
 * stripped and rewritten on the way, and every refusal (session, floor
 * access, owner-only, undiscovered ports, localhost-only, the office's own
 * port, cross-origin requests).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { servicesProxyPath } from "@regulus/protocol";
import {
  FakeRunner,
  type ServicesOffice,
  startServicesOffice,
  startUpstream,
} from "./test-helpers.ts";

describe("services proxy, path mode", () => {
  let office: ServicesOffice;
  let upstream: ReturnType<typeof startUpstream>;
  const runner = new FakeRunner("linux-user");
  let owner: { id: string; cookie: string };
  let teammate: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let admin: { id: string; cookie: string };
  let prefix: string;

  const get = (path: string, cookie?: string, init: RequestInit = {}) =>
    fetch(new URL(path, office.server.url), {
      redirect: "manual",
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string>) },
    });

  beforeAll(async () => {
    upstream = startUpstream();
    office = await startServicesOffice({ runner: runner.asRunner() });
    owner = await office.signUp("Owner");
    teammate = await office.signUp("Teammate");
    outsider = await office.signUp("Outsider");
    admin = await office.signUp("Admin", "admin");
    office.addFloor("f1", { [owner.id]: "spawn", [teammate.id]: "spawn" });
    office.addFloor("f2", { [outsider.id]: "spawn" });
    office.addAgent("a1", "f1", owner.id);
    office.addAgent("a2", "f1", owner.id);
    office.addAgent("a3", "f1", owner.id);
    runner.ports.set("a1", [{ port: upstream.port, address: "127.0.0.1", pid: 10 }]);
    runner.processes.set("a1", [{ pid: 10, ppid: 1, command: "node" }]);
    // a2 sits in a sandbox and binds loopback only: unreachable.
    runner.sandboxes.set("a2", {
      userId: owner.id,
      agentId: "a2",
      host: "10.231.0.2",
      ports: { first: 20_000, last: 20_009 },
    });
    runner.ports.set("a2", [{ port: 5173, address: "127.0.0.1", pid: 11 }]);
    // a3 claims to listen on the office's own port (no sandbox, loopback): never proxied.
    runner.ports.set("a3", [{ port: office.server.port, address: "0.0.0.0", pid: 12 }]);
    await office.scanner.tick();
    prefix = servicesProxyPath("f1", "a1", upstream.port);
  });

  afterAll(async () => {
    await office?.stop();
    upstream?.server.stop(true);
  });

  test("the scan publishes the floor's apps with proxy paths", () => {
    const list = office.published.get("f1") as {
      agentId: string;
      url: string;
      localOnly: boolean;
      title: string;
      shared: boolean;
    }[];
    const a1 = list.find((s) => s.agentId === "a1");
    expect(a1?.url).toBe(prefix);
    expect(a1?.title).toBe("Test App");
    expect(a1?.shared).toBe(false);
    expect(list.find((s) => s.agentId === "a2")?.localOnly).toBe(true);
  });

  test("the owner reaches the app; office credentials never do", async () => {
    const res = await get(`${prefix}deep/page?x=1`, `${owner.cookie}; app=keep`, {
      headers: { "x-office-dev-user": "someone", "x-forwarded-host": "evil.example" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Test App");
    const seen = upstream.seen.at(-1);
    expect(seen?.path).toBe(`${prefix}deep/page?x=1`);
    expect(seen?.headers.cookie).toBe("app=keep");
    expect(seen?.headers["x-office-dev-user"]).toBeUndefined();
    expect(seen?.headers.host).toBe(`localhost:${upstream.port}`);
    expect(seen?.headers["x-forwarded-host"]).toBe(new URL(office.server.url).host);
    expect(seen?.headers["x-forwarded-prefix"]).toBe(prefix.replace(/\/$/, ""));
    // The app cannot plant an office cookie, scope one to another domain, or wipe the office.
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("office."))).toBe(false);
    expect(cookies).toContain(`app=1; Path=${prefix.replace(/\/$/, "")}; HttpOnly`);
    expect(res.headers.get("clear-site-data")).toBeNull();
  });

  test("POST bodies pass through and redirects stay on the proxy", async () => {
    const res = await get(`${prefix}form`, owner.cookie, {
      method: "POST",
      body: "a=1",
      headers: { origin: office.origin, "content-type": "text/plain" },
    });
    expect(res.status).toBe(200);
    expect(upstream.seen.at(-1)?.body).toBe("a=1");
    const moved = await get(`${prefix}redirect`, owner.cookie);
    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe(`${prefix}elsewhere`);
  });

  test("the prefix without a trailing slash redirects to it", async () => {
    const res = await get(prefix.replace(/\/$/, ""), owner.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(prefix);
  });

  test("a `//host` path stays a path on the robot's server (no SSRF)", async () => {
    const res = await get(`${prefix}/evil.example/x`, owner.cookie);
    expect(res.status).toBe(200);
    expect(upstream.seen.at(-1)?.path).toBe(`${prefix}/evil.example/x`);
  });

  test("WebSocket relays both ways with the app's subprotocol", async () => {
    const url = `${String(office.server.url).replace(/^http/, "ws").replace(/\/$/, "")}${prefix}hmr`;
    const ws = new WebSocket(url, {
      headers: { cookie: owner.cookie, origin: office.origin },
      protocols: ["vite-hmr"],
    } as unknown as string[]);
    const got: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onmessage = (e) => {
        got.push(String(e.data));
        if (got.length === 1) ws.send("ping");
        if (got.length === 2) resolve();
      };
      ws.onerror = () => reject(new Error("ws error"));
      setTimeout(() => reject(new Error(`timeout: ${got}`)), 5000);
    });
    expect(ws.protocol).toBe("vite-hmr");
    expect(got).toEqual(["hello from app", "echo:ping"]);
    ws.close();
  });

  test("refusals", async () => {
    // No session.
    expect((await get(prefix)).status).toBe(401);
    // A floor member who is not the owner: path mode is owner-only (same origin as the office).
    expect((await get(prefix, teammate.cookie)).status).toBe(403);
    // Admins do not control other people's robots (D12).
    expect((await get(prefix, admin.cookie)).status).toBe(403);
    // No access to the floor: the app does not exist for them.
    expect((await get(prefix, outsider.cookie)).status).toBe(404);
    // A port the robot does not listen on, another robot, the wrong floor.
    expect((await get(servicesProxyPath("f1", "a1", 1), owner.cookie)).status).toBe(404);
    expect((await get(servicesProxyPath("f2", "a1", upstream.port), owner.cookie)).status).toBe(
      404,
    );
    expect((await get(servicesProxyPath("f1", "nobody", upstream.port), owner.cookie)).status).toBe(
      404,
    );
    // Localhost-only inside a sandbox: explained, not proxied.
    const local = await get(servicesProxyPath("f1", "a2", 5173), owner.cookie);
    expect(local.status).toBe(502);
    expect(await local.text()).toContain("0.0.0.0");
    // The office's own port on loopback is never a target.
    expect(
      (await get(servicesProxyPath("f1", "a3", office.server.port), owner.cookie)).status,
    ).toBe(404);
    // Cross-origin writes and WebSockets.
    const post = await get(prefix, owner.cookie, {
      method: "POST",
      body: "x",
      headers: { origin: "https://evil.example" },
    });
    expect(post.status).toBe(403);
    const ws = await get(prefix, owner.cookie, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        origin: "https://evil.example",
      },
    });
    expect(ws.status).toBe(403);
    // Malformed paths.
    expect((await get("/p/f1/a/a1/port/99999/", owner.cookie)).status).toBe(404);
    expect((await get("/p/f1/a/a%2F1/port/80/", owner.cookie)).status).toBe(404);
  });

  test("a robot that goes down takes its apps with it", async () => {
    runner.ports.set("a1", []);
    await office.scanner.tick();
    expect((await get(prefix, owner.cookie)).status).toBe(404);
    runner.ports.set("a1", [{ port: upstream.port, address: "0.0.0.0", pid: 10 }]);
    await office.scanner.tick();
    expect((await get(prefix, owner.cookie)).status).toBe(200);
  });
});
