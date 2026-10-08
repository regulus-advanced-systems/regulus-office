/**
 * Fixtures for the terminal bridge tests: an office server with real auth, the
 * bridge and the Colyseus rooms behind one `WsRouter`, database rows for
 * operations and henchmen, and a small WebSocket client that records frames.
 */
import {
  parseScreenFeedMessage,
  parseTerminalServerMessage,
  type ScreenFeedMessage,
  screensWsPath,
  type TerminalMode,
  type TerminalServerMessage,
  terminalWsPath,
  type UserRole,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth/auth.ts";
import { dbAccessSubjects, LiveAccess } from "../auth/live-access.ts";
import { cookieHeaderFrom, mountAuthRoutes } from "../auth/routes.ts";
import { PASSWORD, TEST_SECRET } from "../auth/test-helpers.ts";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";
import { agents, operationRepos, operations, userProfiles } from "../db/schema/index.ts";
import { seedRoomMember } from "../github/access/test-snapshot.ts";
import { createOfficeServer } from "../http/server.ts";
import { WsRouter } from "../http/ws-router.ts";
import { createLogger } from "../logging.ts";
import { createSessionRoomAuth } from "../rooms/auth.ts";
import { createRooms } from "../rooms/index.ts";
import type { Runner } from "../runners/types.ts";
import { dbOperationVisibility } from "./acl.ts";
import { TerminalBridge, type TerminalBridgeOptions } from "./bridge.ts";
import { ScreenFeed, type ScreenFeedOptions } from "./screens.ts";
import { DbTerminalTargets, RunnerRegistry } from "./targets.ts";

export interface TerminalOfficeOptions {
  runner: Runner;
  bridge?: Partial<TerminalBridgeOptions>;
  screens?: Partial<ScreenFeedOptions>;
}

export async function startTerminalOffice(options: TerminalOfficeOptions) {
  const logger = createLogger({ level: "silent" });
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  let auth: ReturnType<typeof createAuth> | undefined;
  const sessions = {
    getSessionFromRequest: (request: Request) =>
      auth?.getSessionFromRequest(request) ?? Promise.resolve(null),
  };
  // Live access (#244), wired as in index.ts.
  const liveAccess = new LiveAccess({ subjects: dbAccessSubjects(db), logger });
  const rooms = createRooms({
    db,
    logger,
    liveAccess,
    auth: createSessionRoomAuth(sessions),
    publicUrl: "http://127.0.0.1",
    production: false,
  });
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
  mountAuthRoutes(server.router, auth, {
    onUserChanged: (userId) => liveAccess.accessChanged({ userId }),
  });
  const targets = new DbTerminalTargets(db, new RunnerRegistry().setDefault(options.runner));
  const bridge = new TerminalBridge({
    targets,
    sessions,
    canViewOperation: dbOperationVisibility(db),
    // Production policy: only the office's own origin, no localhost wildcard.
    originPolicy: { publicUrl: String(server.url) },
    logger,
    liveAccess,
    ...options.bridge,
  });
  const screens = new ScreenFeed({
    sources: targets,
    sessions,
    canViewOperation: dbOperationVisibility(db),
    originPolicy: { publicUrl: String(server.url) },
    logger,
    liveAccess,
    ...options.screens,
  });
  router.use(bridge).use(screens).use(rooms.transport.attachment);
  await rooms.transport.listen();

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

  /** An operation with a repo; `members` is each person's GitHub-given access to it (#270). */
  const addOperation = (id: string, members: Record<string, "manage" | "spawn" | "view"> = {}) => {
    db.insert(operations)
      .values({ id, name: id, slug: id, index: seq + 1, paletteId: "p", layoutTemplateId: "t" })
      .run();
    db.insert(operationRepos)
      .values({
        id: `${id}-repo`,
        operationId: id,
        owner: "o",
        name: id,
        url: "https://example.invalid",
        workdir: "/tmp",
      })
      .run();
    for (const [userId, access] of Object.entries(members)) {
      seedRoomMember(db, userId, id, access);
    }
  };

  const addAgent = (id: string, operationId: string, ownerUserId: string) => {
    db.insert(agents)
      .values({
        id,
        operationId,
        repoId: `${operationId}-repo`,
        deskSeatId: "s1",
        ownerUserId,
        provider: "custom",
        model: "fake",
        profileId: "p",
        workdir: "/tmp",
        taskTitle: "test",
        tmuxSession: `agent-${id}`,
      })
      .run();
  };

  const wsUrl = (agentId: string, mode: TerminalMode) =>
    `${String(server.url).replace(/^http/, "ws").replace(/\/$/, "")}${terminalWsPath(agentId, mode)}`;

  /** A would-be upgrade over plain fetch, to read the rejection status. */
  const probe = (agentId: string, mode: string, headers: Record<string, string> = {}) =>
    fetch(new URL(`/ws/term/${agentId}?mode=${mode}`, server.url), {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        origin,
        ...headers,
      },
    });

  const subscribeScreens = (operationId: string, cookie: string) =>
    FeedClient.open(
      `${String(server.url).replace(/^http/, "ws").replace(/\/$/, "")}${screensWsPath(operationId)}`,
      { cookie, origin },
    );

  const connect = (agentId: string, mode: TerminalMode, cookie: string, extra = {}) =>
    TermClient.open(wsUrl(agentId, mode), { cookie, origin, ...extra });

  return {
    db,
    server,
    origin,
    bridge,
    screens,
    rooms,
    liveAccess,
    signUp,
    addOperation,
    addAgent,
    probe,
    connect,
    subscribeScreens,
    async stop() {
      bridge.shutdown();
      screens.shutdown();
      await rooms.transport.shutdown();
      await server.stop(true);
      db.$client.close();
    },
  };
}

export type TerminalOffice = Awaited<ReturnType<typeof startTerminalOffice>>;

type Frame = { text: TerminalServerMessage } | { bytes: Uint8Array };

/** Records every frame; `output` is the decoded binary stream so far. */
export class TermClient {
  readonly frames: Frame[] = [];
  output = "";
  closeCode: number | undefined;
  readonly closed: Promise<number>;
  readonly #decoder = new TextDecoder();

  private constructor(readonly ws: WebSocket) {
    ws.binaryType = "arraybuffer";
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const message = parseTerminalServerMessage(event.data);
        if (message) this.frames.push({ text: message });
        return;
      }
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      this.frames.push({ bytes });
      this.output += this.#decoder.decode(bytes, { stream: true });
    };
    this.closed = new Promise((resolve) => {
      ws.addEventListener("close", (event) => {
        this.closeCode = event.code;
        resolve(event.code);
      });
    });
  }

  static open(url: string, headers: Record<string, string>): Promise<TermClient> {
    // Bun's WebSocket accepts headers (cookie, origin) like a browser would send.
    const ws = new WebSocket(url, { headers } as unknown as string[]);
    const client = new TermClient(ws);
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(client);
      ws.onerror = () => reject(new Error("websocket failed"));
    });
  }

  get controls(): TerminalServerMessage[] {
    return this.frames.flatMap((f) => ("text" in f ? [f.text] : []));
  }

  get hello() {
    const first = this.frames[0];
    return first && "text" in first && first.text.type === "hello" ? first.text : undefined;
  }

  type(text: string): void {
    this.ws.send(new TextEncoder().encode(text));
  }

  resize(cols: number, rows: number): void {
    this.ws.send(JSON.stringify({ type: "resize", cols, rows }));
  }

  async waitFor(check: (c: TermClient) => boolean, what: string, ms = 5000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!check(this)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(5);
    }
  }

  close(): Promise<number> {
    this.ws.close();
    return this.closed;
  }
}

/** Records laptop screen feed messages (`/ws/screens/<operationId>`). */
export class FeedClient {
  readonly messages: ScreenFeedMessage[] = [];
  readonly closed: Promise<number>;
  private constructor(readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const message = parseScreenFeedMessage(String(event.data));
      if (message) this.messages.push(message);
    };
    this.closed = new Promise((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  }
  static open(url: string, headers: Record<string, string>): Promise<FeedClient> {
    const ws = new WebSocket(url, { headers } as unknown as string[]);
    const client = new FeedClient(ws);
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(client);
      ws.onerror = () => reject(new Error("websocket failed"));
    });
  }
  screens(agentId: string): string[] {
    return this.messages.flatMap((m) =>
      m.type === "screen" && m.agentId === agentId ? [m.text] : [],
    );
  }
  async waitFor(check: (c: FeedClient) => boolean, what: string, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!check(this)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(5);
    }
  }
  close(): Promise<number> {
    this.ws.close();
    return this.closed;
  }
}
