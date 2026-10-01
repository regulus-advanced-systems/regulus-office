/**
 * App domain mode (#39, optional): each service is served on its own origin,
 * `<port>-<agentId>.<OFFICE_SERVICES_DOMAIN>`, so the app's scripts never run
 * on the office's origin (they cannot call the office API with the viewer's
 * session, read its cookies or register a service worker over it). Needs a
 * wildcard DNS record and certificate for the domain (docs/deploy/services-proxy.md).
 *
 * The office session cookie is host-only, so the app host does not see it.
 * Opening an app goes through the office first: `/p/<operation>/a/<agent>/port/<n>/`
 * checks the session and redirects with a one-time ticket (60 s) to
 * `/.office/auth` on the app host, which swaps it for a host-only app cookie
 * (12 h) bound to that user, henchman and port. Both are HMAC-signed with a key
 * made at boot, so a restart only sends people through the office once more.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const APP_AUTH_PATH = "/.office/auth";
export const TICKET_TTL_MS = 60_000;
export const APP_COOKIE_TTL_MS = 12 * 60 * 60 * 1000;

const LABEL_RE = /^([1-9]\d{0,4})-([a-z0-9][a-z0-9-]{0,56})$/;

export interface AppDomain {
  /** e.g. `apps.office.example`. */
  domain: string;
  /** `http:` or `https:`, from the office's public URL. */
  protocol: string;
  /** `:<port>` when the public URL has an explicit port, else "". */
  portSuffix: string;
}

export function appDomainFrom(domain: string | undefined, publicUrl: string): AppDomain | null {
  const d = domain?.trim().toLowerCase().replace(/\.$/, "");
  if (!d) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) {
    throw new Error(`OFFICE_SERVICES_DOMAIN is not a domain name: ${d}`);
  }
  const url = new URL(publicUrl);
  if (url.hostname === d) {
    throw new Error("OFFICE_SERVICES_DOMAIN must differ from the office's own host");
  }
  return { domain: d, protocol: url.protocol, portSuffix: url.port ? `:${url.port}` : "" };
}

/** The DNS label of a service, or null when the agent id cannot be one (then not shared). */
export function appLabel(agentId: string, port: number): string | null {
  const label = `${port}-${agentId}`;
  return label.length <= 63 && LABEL_RE.test(label) ? label : null;
}

export function appOrigin(d: AppDomain, label: string): string {
  return `${d.protocol}//${label}.${d.domain}${d.portSuffix}`;
}

/** Henchman and port from an app host name, or null when it is not one of ours. */
export function parseAppHost(
  d: AppDomain,
  hostname: string,
): { agentId: string; port: number; label: string } | null {
  const host = hostname.toLowerCase();
  const suffix = `.${d.domain}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  const m = LABEL_RE.exec(label);
  if (!m?.[1] || !m[2]) return null;
  const port = Number(m[1]);
  return port <= 65_535 ? { agentId: m[2], port, label } : null;
}

interface Claims {
  /** `t` ticket, `c` cookie. */
  k: "t" | "c";
  u: string;
  a: string;
  p: number;
  e: number;
  n?: string;
}

export interface AppGrant {
  userId: string;
  agentId: string;
  port: number;
}

export class AppTokens {
  readonly #key: Buffer;
  readonly #used = new Map<string, number>();
  readonly #now: () => number;

  constructor(opts: { key?: Buffer; now?: () => number } = {}) {
    this.#key = opts.key ?? randomBytes(32);
    this.#now = opts.now ?? Date.now;
  }

  ticket(g: AppGrant): string {
    const n = randomBytes(12).toString("base64url");
    return this.#sign({
      k: "t",
      u: g.userId,
      a: g.agentId,
      p: g.port,
      e: this.#now() + TICKET_TTL_MS,
      n,
    });
  }

  cookie(g: AppGrant): string {
    return this.#sign({
      k: "c",
      u: g.userId,
      a: g.agentId,
      p: g.port,
      e: this.#now() + APP_COOKIE_TTL_MS,
    });
  }

  /** A valid, unused ticket for this henchman and port (single use). */
  redeemTicket(token: string, agentId: string, port: number): AppGrant | null {
    const c = this.#verify(token, "t", agentId, port);
    if (!c?.n || this.#used.has(c.n)) return null;
    this.#prune();
    this.#used.set(c.n, c.e);
    return { userId: c.u, agentId: c.a, port: c.p };
  }

  verifyCookie(token: string, agentId: string, port: number): AppGrant | null {
    const c = this.#verify(token, "c", agentId, port);
    return c ? { userId: c.u, agentId: c.a, port: c.p } : null;
  }

  #sign(claims: Claims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${body}.${this.#mac(body)}`;
  }

  #mac(body: string): string {
    return createHmac("sha256", this.#key).update(body).digest("base64url");
  }

  #verify(token: string, kind: Claims["k"], agentId: string, port: number): Claims | null {
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra !== undefined || token.length > 1024) return null;
    const want = Buffer.from(this.#mac(body));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    let c: Claims;
    try {
      c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    } catch {
      return null;
    }
    if (c.k !== kind || c.a !== agentId || c.p !== port || typeof c.u !== "string") return null;
    return typeof c.e === "number" && c.e > this.#now() ? c : null;
  }

  #prune(): void {
    const now = this.#now();
    for (const [n, exp] of this.#used) if (exp <= now) this.#used.delete(n);
  }
}

/** Name of the app cookie: `__Host-` on https so no other host can set or scope it. */
export function appCookieName(protocol: string): string {
  return protocol === "https:" ? "__Host-office.app" : "office.app";
}

export function appCookieHeader(protocol: string, value: string): string {
  const secure = protocol === "https:" ? "; Secure" : "";
  const maxAge = Math.floor(APP_COOKIE_TTL_MS / 1000);
  return `${appCookieName(protocol)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** A `to` parameter that stays on the app host: a path, never `//host` or `/\\host`. */
export function safeReturnPath(to: string | null): string {
  if (!to || !to.startsWith("/") || to.startsWith("//") || to.startsWith("/\\")) return "/";
  return /[\r\n]/.test(to) ? "/" : to;
}
