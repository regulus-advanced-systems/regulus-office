/**
 * Fixtures for the whiteboard tests: an office server with real auth, the
 * rooms and the whiteboard endpoint behind one `WsRouter`, operations and
 * members in the database, and stock `y-websocket` clients that send the
 * session cookie and Origin like a browser.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type UserRole, WHITEBOARD_Y_ELEMENTS, whiteboardWsBase } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { createAuth } from "../auth/auth.ts";
import { dbAccessSubjects, LiveAccess } from "../auth/live-access.ts";
import { cookieHeaderFrom, mountAuthRoutes } from "../auth/routes.ts";
import { PASSWORD, TEST_SECRET } from "../auth/test-helpers.ts";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";
import { operations, userProfiles } from "../db/schema/index.ts";
import { seedRoomMember, seedRoomRepo } from "../github/access/test-snapshot.ts";
import { createOfficeServer } from "../http/server.ts";
import { WsRouter } from "../http/ws-router.ts";
import { createLogger } from "../logging.ts";
import { createWhiteboards } from "./index.ts";

export async function startWhiteboardOffice(options: { saveDelayMs?: number } = {}) {
  const logger = createLogger({ level: "silent" });
  const dataDir = mkdtempSync(join(tmpdir(), "regulus-wb-"));
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
  // Live access (#244), wired as in index.ts: role and session changes ask again.
  const liveAccess = new LiveAccess({ subjects: dbAccessSubjects(db), logger });
  mountAuthRoutes(server.router, auth, {
    onUserChanged: (userId) => liveAccess.accessChanged({ userId }),
  });
  const snapshots: Array<{ boardId: string; version: number }> = [];
  const whiteboards = createWhiteboards({
    db,
    sessions,
    logger,
    dataDir,
    // Production policy: only the office's own origin.
    originPolicy: { publicUrl: String(server.url) },
    liveAccess,
    onSnapshot: (boardId, version) => snapshots.push({ boardId, version }),
    saveDelayMs: options.saveDelayMs ?? 20,
    maxSaveDelayMs: 100,
  });
  whiteboards.mount(server.router, auth);
  router.use(whiteboards.endpoint);

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
    seq += 1;
    db.insert(operations)
      .values({ id, name: id, slug: id, index: seq, paletteId: "p", layoutTemplateId: "t" })
      .run();
    seedRoomRepo(db, id);
    for (const [userId, access] of Object.entries(members)) {
      seedRoomMember(db, userId, id, access);
    }
  };

  const wsBase = whiteboardWsBase(String(server.url).replace(/^http/, "ws"));

  /** A y-websocket client on `boardId` as the holder of `cookie`. */
  const client = (
    boardId: string,
    cookie: string,
    headers: Record<string, string> = {},
    providerOptions: { shouldReconnect?: (event: { code: number }) => boolean } = {},
  ) => {
    const doc = new Y.Doc();
    const sent = { cookie, origin, ...headers };
    class CookieSocket extends WebSocket {
      constructor(url: string | URL) {
        super(url, { headers: sent } as unknown as string[]);
      }
    }
    const provider = new WebsocketProvider(wsBase, encodeURIComponent(boardId), doc, {
      WebSocketPolyfill: CookieSocket as unknown as typeof WebSocket,
      disableBc: true,
      maxBackoffTime: 100,
      ...providerOptions,
    });
    return { doc, provider, elements: doc.getArray<Y.Map<unknown>>(WHITEBOARD_Y_ELEMENTS) };
  };

  return {
    db,
    server,
    origin,
    dataDir,
    whiteboards,
    liveAccess,
    snapshots,
    signUp,
    addOperation,
    client,
    async stop() {
      whiteboards.shutdown();
      await server.stop(true);
      db.$client.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export type WhiteboardOffice = Awaited<ReturnType<typeof startWhiteboardOffice>>;

/** Poll until `check` holds. */
export async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

/** Append an Excalidraw-shaped element the way y-excalidraw stores one. */
export function draw(elements: Y.Array<Y.Map<unknown>>, id: string, pos = id): void {
  const entry = new Y.Map<unknown>();
  entry.set("pos", pos);
  entry.set("el", { id, type: "rectangle", version: 1, x: 0, y: 0, width: 10, height: 10 });
  elements.push([entry]);
}

export const ids = (elements: Y.Array<Y.Map<unknown>>): string[] =>
  elements
    .toArray()
    .map((m) => (m.get("el") as { id: string }).id)
    .sort();
