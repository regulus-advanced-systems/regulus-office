import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createLogger } from "../logging.ts";
import { UPGRADED } from "../rooms/transport.ts";
import { createOfficeServer, type OfficeServer } from "./server.ts";
import { type WsRoute, WsRouter } from "./ws-router.ts";

interface EchoData {
  name: string;
  opened?: boolean;
}

/** A WebSocket endpoint under `/<name>/…` that echoes with its own prefix. */
function echoRoute(name: string, events: string[], label?: string): WsRoute {
  return {
    routeOf: label
      ? (url) => (url.pathname.startsWith(`/${name}/`) ? label : undefined)
      : undefined,
    async fetch(request, url, server) {
      if (!url.pathname.startsWith(`/${name}/`)) return undefined;
      if (url.pathname.endsWith("/deny")) return new Response(null, { status: 403 });
      const data: EchoData = { name };
      return server.upgrade(request, { data }) ? UPGRADED : undefined;
    },
    websocket: {
      open(ws) {
        const data = (ws as ServerWebSocket<EchoData>).data;
        data.opened = true;
        events.push(`${name}:open`);
      },
      message(ws, message) {
        const data = (ws as ServerWebSocket<EchoData>).data;
        ws.send(`${data.name}:${String(message)}:${data.opened}`);
      },
      close() {
        events.push(`${name}:close`);
      },
    },
  };
}

async function roundTrip(url: string, text: string): Promise<string> {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const reply = new Promise<string>((resolve) => {
    ws.onmessage = (e) => resolve(String(e.data));
  });
  ws.send(text);
  const out = await reply;
  ws.close();
  return out;
}

describe("WsRouter", () => {
  const events: string[] = [];
  let server: OfficeServer;
  let base: string;

  beforeAll(() => {
    const router = new WsRouter()
      .use(echoRoute("term", events, "/term/:id"))
      .use(echoRoute("rooms", events));
    server = createOfficeServer({
      config: { port: 0, host: "127.0.0.1", webDist: "/nonexistent" },
      logger: createLogger({ level: "silent" }),
      version: "test",
      attach: router,
    });
    base = String(server.url).replace(/^http/, "ws").replace(/\/$/, "");
  });

  afterAll(() => server.stop(true));

  test("dispatches each socket to the attachment that upgraded it", async () => {
    expect(await roundTrip(`${base}/term/abc`, "hi")).toBe("term:hi:true");
    expect(await roundTrip(`${base}/rooms/p/r`, "yo")).toBe("rooms:yo:true");
    await Bun.sleep(20);
    expect(events).toEqual(["term:open", "term:close", "rooms:open", "rooms:close"]);
  });

  test("responses from an attachment pass through; unknown paths reach the router", async () => {
    expect((await fetch(new URL("/term/deny", server.url))).status).toBe(403);
    expect((await fetch(new URL("/healthz", server.url))).status).toBe(200);
  });

  test("metrics label the route by pattern, never the raw id", async () => {
    await fetch(new URL("/term/secret-agent-id/deny", server.url));
    const metrics = await (await fetch(new URL("/metrics", server.url))).text();
    expect(metrics).toContain('route="/term/:id"');
    expect(metrics).not.toContain("secret-agent-id");
  });
});
