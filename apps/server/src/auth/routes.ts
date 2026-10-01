/**
 * HTTP surface of the auth layer. Mounts Better Auth under /api/auth/* and the
 * office's own routes: /api/me, invites, /join/:token sign-up, role changes.
 * Boot wiring is one call: `mountAuthRoutes(server.router, createAuth(deps))`.
 */
import { USER_ROLES } from "@regulus/protocol";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "../db/schema/index.ts";
import { json, type RouteContext, type RouteHandler, type Router } from "../http/router.ts";
import { AUTH_BASE_PATH, type OfficeAuth, type SessionUser } from "./auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "./errors.ts";
import { claimInvite, createInvite, joinPathFor, peekInvite } from "./invites.ts";
import { checkOrigin } from "./origin.ts";
import { clientIp, type RateLimitRule, rateLimited, TokenBucketLimiter } from "./rate-limit.ts";
import { setUserRole } from "./roles.ts";

export interface AuthRouteLimits {
  /** Sign-in, sign-up and invite consumption: brute-force brake. */
  login: RateLimitRule;
  /** Invite creation and lookup. */
  invite: RateLimitRule;
}

export const DEFAULT_AUTH_LIMITS: AuthRouteLimits = {
  login: { capacity: 10, refillPerSecond: 10 / 60 },
  invite: { capacity: 30, refillPerSecond: 30 / 60 },
};

export interface MountAuthRoutesOptions {
  limits?: Partial<AuthRouteLimits>;
  /** Client address for rate-limit keys; defaults to forwarded headers, else "direct". */
  ipOf?: (request: Request) => string;
}

export interface MountedAuthRoutes {
  limiters: { login: TokenBucketLimiter; invite: TokenBucketLimiter };
}

const roleSchema = z.enum(USER_ROLES);
const inviteBody = z.object({ role: roleSchema.default("member") });
const roleBody = z.object({ role: roleSchema });
const joinBody = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
});

async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AuthHttpError(400, "invalid_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))];
    throw new AuthHttpError(400, "invalid_body", { fields });
  }
  return parsed.data;
}

/** Turn thrown {@link AuthHttpError}s into responses; anything else propagates to the 500 handler. */
const guarded =
  (handler: RouteHandler): RouteHandler =>
  async (ctx) => {
    try {
      return await handler(ctx);
    } catch (err) {
      if (err instanceof AuthHttpError) return err.toResponse();
      throw err;
    }
  };

/** Public, unauthenticated: `{ hasUsers, githubEnabled, openSignup }` for the login page. */
export const AUTH_CONFIG_PATH = "/api/auth-config";

const LOGIN_PREFIXES = ["sign-in/", "sign-up/"];

export function mountAuthRoutes(
  router: Router,
  auth: OfficeAuth,
  options: MountAuthRoutesOptions = {},
): MountedAuthRoutes {
  const limits = { ...DEFAULT_AUTH_LIMITS, ...options.limits };
  const ipOf = options.ipOf ?? clientIp;
  const limiters = {
    login: new TokenBucketLimiter(limits.login, auth.now),
    invite: new TokenBucketLimiter(limits.invite, auth.now),
  };
  const limit = (which: keyof typeof limiters, handler: RouteHandler) =>
    rateLimited(limiters[which], which, guarded(handler), ipOf);

  /** Cookie-bearing state changes must come from the office's own origin (CSRF). */
  const requireSameOrigin = (request: Request): void => {
    const check = checkOrigin(request, auth.publicUrl, { allowedOrigins: auth.allowedOrigins });
    if (!check.ok) throw forbidden("origin_mismatch");
  };

  const requireUser = async (request: Request): Promise<SessionUser> => {
    const user = await auth.getSessionFromRequest(request);
    if (!user) throw unauthorized();
    return user;
  };

  // ---- Better Auth -------------------------------------------------------
  const passthrough: RouteHandler = (ctx) => auth.handler(ctx.request);
  const betterAuthRoute: RouteHandler = (ctx) => {
    const rest = ctx.params["*"] ?? "";
    const isLogin = ctx.request.method === "POST" && LOGIN_PREFIXES.some((p) => rest.startsWith(p));
    return isLogin ? limit("login", passthrough)(ctx) : passthrough(ctx);
  };
  router.get(`${AUTH_BASE_PATH}/*`, betterAuthRoute);
  router.post(`${AUTH_BASE_PATH}/*`, betterAuthRoute);

  // ---- Public sign-in configuration ---------------------------------------
  /**
   * What the login page needs to render itself: whether the owner account
   * still has to be created, and which sign-in options exist. No secrets and
   * nothing per-user; `hasUsers` only says whether the office is bootstrapped.
   */
  router.get(
    AUTH_CONFIG_PATH,
    guarded(() => {
      const [row] = auth.db.select({ n: count() }).from(users).all();
      return json({
        hasUsers: (row?.n ?? 0) > 0,
        githubEnabled: auth.githubEnabled,
        openSignup: auth.openSignup,
      });
    }),
  );

  // ---- Who am I ----------------------------------------------------------
  router.get(
    "/api/me",
    guarded(async ({ request }) => {
      const user = await requireUser(request);
      return json({
        id: user.id,
        displayName: user.displayName,
        role: user.role,
        avatar: user.avatar,
        avatarChosen: user.avatarChosen,
      });
    }),
  );

  // ---- Invites -----------------------------------------------------------
  router.post(
    "/api/invites",
    limit("invite", async ({ request }) => {
      requireSameOrigin(request);
      const actor = await requireUser(request);
      const body = await readBody(request, inviteBody);
      const invite = createInvite(auth.db, { actor, role: body.role, now: auth.now() });
      return json(
        {
          id: invite.id,
          token: invite.token,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
          url: new URL(joinPathFor(invite.token), auth.publicUrl).toString(),
        },
        { status: 201 },
      );
    }),
  );

  router.get(
    "/api/invites/:token",
    limit("invite", ({ params }) => {
      const found = peekInvite(auth.db, params.token ?? "", auth.now());
      if (!found.ok)
        return json({ error: "invite_invalid", reason: found.reason }, { status: 404 });
      return json({ role: found.invite.role, expiresAt: found.invite.expiresAt.toISOString() });
    }),
  );

  router.post(
    "/api/join/:token",
    limit("login", (ctx) => joinWithInvite(auth, ctx)),
  );

  // ---- Roles -------------------------------------------------------------
  router.add(
    "PATCH",
    "/api/users/:userId/role",
    guarded(async ({ request, params }) => {
      requireSameOrigin(request);
      const actor = await requireUser(request);
      const body = await readBody(request, roleBody);
      const change = setUserRole(auth.db, actor, params.userId ?? "", body.role);
      return json({ id: change.userId, role: change.role, previousRole: change.previousRole });
    }),
  );

  return { limiters };
}

/**
 * Email + password sign-up through an invite. The account is created by Better
 * Auth (which signs the browser in), then the invite is claimed atomically; if
 * another sign-up won the same token in between, the new account is removed
 * again and the caller gets 409.
 */
async function joinWithInvite(auth: OfficeAuth, ctx: RouteContext): Promise<Response> {
  const token = ctx.params.token ?? "";
  const body = await readBody(ctx.request, joinBody);
  const found = peekInvite(auth.db, token, auth.now());
  if (!found.ok) return json({ error: "invite_invalid", reason: found.reason }, { status: 404 });

  const signUp = await auth.api.signUpEmail({
    body: { email: body.email, password: body.password, name: body.name },
    headers: auth.markJoinRequest(ctx.request.headers),
    asResponse: true,
  });
  if (!signUp.ok) return signUp;
  const { user } = (await signUp.json()) as { user: { id: string } };

  const claim = claimInvite(auth.db, { token, userId: user.id, now: auth.now() });
  if (!claim.ok) {
    auth.db.delete(users).where(eq(users.id, user.id)).run();
    auth.logger.warn({ userId: user.id, reason: claim.reason }, "invite lost race; sign-up undone");
    return json({ error: "invite_invalid", reason: claim.reason }, { status: 409 });
  }

  const me = await auth.getSessionFromRequest(
    new Request(ctx.request.url, { headers: { cookie: cookieHeaderFrom(signUp.headers) } }),
  );
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const cookie of signUp.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(
    JSON.stringify({ id: user.id, displayName: me?.displayName ?? body.name, role: claim.role }),
    { status: 201, headers },
  );
}

/** Build a `cookie` request header from a response's `set-cookie` values. */
export function cookieHeaderFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => c.length > 0)
    .join("; ");
}
