/**
 * Route plumbing shared by the credential write and login routes: session
 * auth, same-origin check on writes (CSRF), per-user rate limits, body
 * parsing that never echoes input (a body may hold a key), no-store caching.
 */
import type { UserRole } from "@regulus/protocol";
import type { z } from "zod";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { rateLimitedResponse, type TokenBucketLimiter } from "../auth/rate-limit.ts";
import { readJsonBody } from "../http/body.ts";
import { json, type RouteContext, type RouteHandler } from "../http/router.ts";

export interface CredentialActor {
  id: string;
  role: UserRole;
}

export type CredentialAuth = Pick<
  OfficeAuth,
  "getSessionFromRequest" | "publicUrl" | "allowedOrigins"
>;

/** A key request is tiny; anything bigger is refused while reading (#240). */
const MAX_BODY_BYTES = 8 * 1024;

export const readBody = <S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> =>
  readJsonBody(request, schema, { maxBytes: MAX_BODY_BYTES });

export const noStore = (body: unknown, status = 200): Response =>
  json(body, { status, headers: { "cache-control": "no-store" } });

export interface RouteFactoryOptions {
  auth: CredentialAuth;
}

export interface RouteOptions {
  /** State change: require a same-origin request. */
  write?: boolean;
  /** Spend one token of `limiter` per user before the handler runs. */
  limiter?: TokenBucketLimiter;
}

/** Wraps handlers with auth, CSRF, rate limits and AuthHttpError → JSON. */
export function routeFactory({ auth }: RouteFactoryOptions) {
  return (
    handler: (ctx: RouteContext, actor: CredentialActor) => Promise<Response> | Response,
    opts: RouteOptions = {},
  ): RouteHandler =>
    async (ctx) => {
      try {
        if (opts.write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw forbidden("origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        if (opts.limiter) {
          const decision = opts.limiter.take(user.id);
          if (!decision.ok) return rateLimitedResponse(decision);
        }
        return await handler(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };
}
