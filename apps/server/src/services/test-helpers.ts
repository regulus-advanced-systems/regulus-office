/**
 * Fixtures for the services tests: a fake runner that reports chosen
 * listeners, and an office with real auth, the services route and the
 * scanner behind one `WsRouter`, plus floor/robot rows.
 */
import type { UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth/auth.ts";
import { cookieHeaderFrom, mountAuthRoutes } from "../auth/routes.ts";
import { PASSWORD, TEST_SECRET } from "../auth/test-helpers.ts";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";
import { agents, floorMembers, floorRepos, floors, userProfiles } from "../db/schema/index.ts";
import { createOfficeServer } from "../http/server.ts";
import { WsRouter } from "../http/ws-router.ts";
import { createLogger } from "../logging.ts";
import type { AgentRef, PortInfo, ProcessInfo, Runner, SandboxInfo } from "../runners/types.ts";
import { createServices } from "./index.ts";

/** A runner double: listeners, processes, terminal text and sandboxes per robot. */
export class FakeRunner {
  readonly backend: "linux-user" | "docker";
  ports = new Map<string, PortInfo[]>();
  processes = new Map<string, ProcessInfo[]>();
  screens = new Map<string, string>();
  sandboxes = new Map<string, SandboxInfo>();
  listPortCalls = 0;

  constructor(backend: "linux-user" | "docker" = "linux-user") {
    this.backend = backend;
  }

  async listPorts(a: AgentRef): Promise<PortInfo[]> {
    this.listPortCalls++;
    return this.ports.get(a.agentId) ?? [];
  }
  async listProcesses(a: AgentRef): Promise<ProcessInfo[]> {
    return this.processes.get(a.agentId) ?? [];
  }
  async capturePane(s: { name: string }): Promise<string> {
    return this.screens.get(s.name.replace(/^agent-/, "")) ?? "";
  }
  async sandboxOf(a: AgentRef): Promise<SandboxInfo | null> {
    const s = this.sandboxes.get(a.agentId);
    return s && s.userId === a.userId ? s : null;
  }
  asRunner(): Runner {
    return this as unknown as Runner;
  }
}

export interface ServicesOfficeOptions {
  runner: Runner;
  /** `OFFICE_SERVICES_DOMAIN`. */
  appDomain?: string;
}

export async function startServicesOffice(options: ServicesOfficeOptions) {
  const logger = createLogger({ level: "silent" });
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  let auth: ReturnType<typeof createAuth> | undefined;
  const sessions = {
    getSessionFromRequest: (request: Request) =>
      auth?.getSessionFromRequest(request) ?? Promise.resolve(null),
  };
  const router = new WsRouter();
  const server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: "/nonexistent" },
    logger,
    version: "test",
    attach: router,
  });
  const origin = new URL(server.url).origin;
  auth = createAuth({
    db,
    logger,
    config: {
      betterAuthSecret: TEST_SECRET,
      publicUrl: String(server.url),
      githubOAuth: undefined,
      openSignup: true,
    },
  });
  mountAuthRoutes(server.router, auth);
  const published = new Map<string, unknown[]>();
  const services = createServices({
    db,
    floors: { publishServices: (floorId, list) => published.set(floorId, [...list]) },
    sessions,
    // Production policy: only the office's own origin.
    originPolicy: { publicUrl: origin },
    officePort: server.port,
    appDomain: options.appDomain,
    logger,
    intervalMs: 60_000,
  });
  router.use(services.route);
  const scanner = services.start(options.runner);
  await scanner.stop(); // tests drive ticks themselves

  let seq = 0;
  const signUp = async (name: string, role?: UserRole) => {
    seq += 1;
    const email = `${name.toLowerCase()}${seq}@example.com`;
    const res = await fetch(new URL("/api/auth/sign-up/email", server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    });
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`);
    const body = (await res.json()) as { user: { id: string } };
    if (role)
      db.update(userProfiles).set({ role }).where(eq(userProfiles.userId, body.user.id)).run();
    return { id: body.user.id, cookie: cookieHeaderFrom(res.headers) };
  };

  const addFloor = (id: string, members: Record<string, "manage" | "spawn" | "view"> = {}) => {
    db.insert(floors)
      .values({ id, name: id, slug: id, index: seq + 1, paletteId: "p", layoutTemplateId: "t" })
      .run();
    db.insert(floorRepos)
      .values({
        id: `${id}-repo`,
        floorId: id,
        owner: "o",
        name: id,
        url: "https://example.invalid",
        workdir: "/tmp",
      })
      .run();
    for (const [userId, access] of Object.entries(members)) {
      db.insert(floorMembers).values({ floorId: id, userId, access }).run();
    }
  };

  const addAgent = (id: string, floorId: string, ownerUserId: string, status = "working") => {
    db.insert(agents)
      .values({
        id,
        floorId,
        repoId: `${floorId}-repo`,
        deskSeatId: `s-${id}`,
        ownerUserId,
        provider: "custom",
        model: "fake",
        profileId: "p",
        workdir: "/tmp",
        taskTitle: "test",
        tmuxSession: `agent-${id}`,
        status: status as "working",
      })
      .run();
  };

  return {
    db,
    server,
    origin,
    services,
    scanner,
    published,
    signUp,
    addFloor,
    addAgent,
    async stop() {
      await scanner.stop();
      await server.stop(true);
      db.$client.close();
    },
  };
}

export type ServicesOffice = Awaited<ReturnType<typeof startServicesOffice>>;

/** A dev server double: echoes what it received, sets cookies, redirects, and a WebSocket echo. */
export function startUpstream(hostname = "127.0.0.1") {
  const seen: { path: string; headers: Record<string, string>; method: string; body: string }[] =
    [];
  const server = Bun.serve({
    port: 0,
    hostname,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const proto = req.headers.get("sec-websocket-protocol")?.split(",")[0]?.trim();
        const headers = proto ? { "sec-websocket-protocol": proto } : undefined;
        if (srv.upgrade(req, { headers })) return;
      }
      const body = await req.text();
      seen.push({
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(req.headers),
        method: req.method,
        body,
      });
      if (url.pathname.endsWith("/redirect")) {
        return new Response(null, {
          status: 302,
          headers: { location: `http://localhost:${srv.port}/elsewhere` },
        });
      }
      const headers = new Headers({ "content-type": "text/html", "clear-site-data": '"*"' });
      headers.append("set-cookie", "office.session_token=evil; Path=/");
      headers.append("set-cookie", "app=1; Path=/; Domain=example.com; HttpOnly");
      return new Response("<title>Test App</title>ok", { headers });
    },
    websocket: {
      open(ws) {
        ws.send("hello from app");
      },
      message(ws, m) {
        ws.send(`echo:${m}`);
      },
    },
  });
  return { server, seen, port: server.port as number };
}
