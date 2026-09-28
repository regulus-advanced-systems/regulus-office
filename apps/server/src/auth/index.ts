/**
 * Auth for humans (SPEC §4.2 Auth, §11): Better Auth sessions, office roles,
 * invite links, rate limits and the Origin check used on WebSocket upgrades.
 *
 * Boot wiring:
 *   const auth = createAuth({ db, logger, config });
 *   mountAuthRoutes(server.router, auth);
 * WebSocket upgrade (rooms/):
 *   checkOrigin(request, config.publicUrl) and auth.getSessionFromRequest(request).
 */
export { AUDIT_ACTIONS, type AuditAction, type AuditEntry, writeAudit } from "./audit.ts";
export {
  AUTH_BASE_PATH,
  AuthConfigError,
  type AuthDeps,
  COOKIE_PREFIX,
  createAuth,
  getSessionFromRequest,
  type OfficeAuth,
  type SessionUser,
  SIGNUP_CLOSED_CODE,
} from "./auth.ts";
export { AuthHttpError } from "./errors.ts";
export {
  claimInvite,
  createInvite,
  INVITE_TTL_MS,
  type Invite,
  type InviteClaim,
  type InviteLookup,
  joinPathFor,
  peekInvite,
} from "./invites.ts";
export { checkOrigin, type OriginCheck, type OriginCheckOptions } from "./origin.ts";
export {
  clientIp,
  type RateLimitDecision,
  type RateLimitRule,
  rateLimited,
  TokenBucketLimiter,
} from "./rate-limit.ts";
export {
  type Actor,
  assertCanAssignRole,
  assertCanInviteRole,
  displayNameFor,
  ensureProfile,
  getProfileByUserId,
  isAdminOrOwner,
  type Profile,
  type RoleChange,
  setUserRole,
} from "./roles.ts";
export {
  type AuthRouteLimits,
  DEFAULT_AUTH_LIMITS,
  type MountAuthRoutesOptions,
  type MountedAuthRoutes,
  mountAuthRoutes,
} from "./routes.ts";
