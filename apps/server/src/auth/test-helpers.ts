/** Shared fixtures for the auth tests: in-memory database, ephemeral server, cookie plumbing. */

import { SecretValue } from "../config.ts";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";
import { createOfficeServer } from "../http/server.ts";
import { createLogger } from "../logging.ts";
import { createAuth } from "./auth.ts";
import { cookieHeaderFrom, type MountAuthRoutesOptions, mountAuthRoutes } from "./routes.ts";

export const TEST_SECRET = new SecretValue(Buffer.alloc(32, 5).toString("base64"));
export const PASSWORD = "correct horse battery staple";

export interface StartOfficeOptions extends MountAuthRoutesOptions {
  /** Default true so tests can register fixtures directly; the policy tests set false. */
  openSignup?: boolean;
}

export function startOffice(options: StartOfficeOptions = {}) {
  const logger = createLogger({ level: "silent" });
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  const server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: "/nonexistent" },
    logger,
    version: "test",
  });
  const clock = { now: Date.now() };
  const auth = createAuth({
    db,
    logger,
    config: {
      betterAuthSecret: TEST_SECRET,
      publicUrl: String(server.url),
      githubOAuth: undefined,
      openSignup: options.openSignup ?? true,
    },
    now: () => clock.now,
  });
  const { openSignup: _openSignup, ...mountOptions } = options;
  const mounted = mountAuthRoutes(server.router, auth, mountOptions);
  const origin = new URL(server.url).origin;

  const request = (path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.ip) headers.set("x-forwarded-for", init.ip);
    if (!headers.has("origin")) headers.set("origin", origin);
    return fetch(new URL(path, server.url), { ...init, headers });
  };
  const post = (
    path: string,
    body: unknown,
    extra: { cookie?: string; ip?: string; origin?: string } = {},
  ) =>
    request(path, {
      method: "POST",
      body: JSON.stringify(body),
      cookie: extra.cookie,
      ip: extra.ip,
      headers: extra.origin ? { origin: extra.origin } : undefined,
    });

  let userSeq = 0;
  const signUp = async (name: string, ip?: string) => {
    userSeq += 1;
    const email = `${name.toLowerCase()}${userSeq}@example.com`;
    const res = await post("/api/auth/sign-up/email", { email, password: PASSWORD, name }, { ip });
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { user: { id: string; email: string } };
    return { id: body.user.id, email, cookie: cookieHeaderFrom(res.headers) };
  };

  return {
    server,
    db,
    auth,
    clock,
    origin,
    limiters: mounted.limiters,
    request,
    post,
    signUp,
    me: (cookie?: string) => request("/api/me", { cookie }),
    async stop() {
      await server.stop(true);
      db.$client.close();
    },
  };
}

export type Office = ReturnType<typeof startOffice>;
