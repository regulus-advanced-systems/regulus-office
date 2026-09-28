/**
 * Seed a fresh office: create the owner account and one invite link.
 *
 * Talks to a running office-server over HTTP through the real API (Better
 * Auth sign-up/sign-in, POST /api/invites), so it exercises the same
 * first-user-becomes-owner and role rules as the browser. Never touches the
 * database directly.
 *
 * Idempotent where it matters: when the office already has users it refuses
 * to create another owner. Given an existing owner/admin's credentials it
 * signs in and only mints a new invite.
 *
 * Usage:
 *   bun scripts/seed.ts --url https://localhost --email owner@example.com [--name Owner]
 *                       [--password …] [--role member|admin|viewer|owner] [--json] [--insecure]
 * Env fallbacks: OFFICE_URL (then OFFICE_PUBLIC_URL), SEED_OWNER_EMAIL, SEED_OWNER_NAME,
 * SEED_OWNER_PASSWORD, SEED_INVITE_ROLE. Without a password for a new owner, one is
 * generated and printed once; it is not stored anywhere.
 */
import { parseArgs } from "node:util";
import { isUserRole, type UserRole } from "@regulus/protocol/src/enums.ts";

export const DEFAULT_URL = "http://localhost:4600";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface SeedOptions {
  /** Office origin as browsers see it (must equal the server's OFFICE_PUBLIC_URL). */
  url: string;
  email: string;
  name: string;
  password?: string;
  role: UserRole;
  /** Accept self-signed certificates (Caddy's internal CA). On by default for localhost. */
  insecure: boolean;
  json: boolean;
}

export interface SeedResult {
  ownerCreated: boolean;
  /** Only when the owner was created without a password; shown once. */
  generatedPassword?: string;
  actor: { email: string; role: string };
  invite: { url: string; role: string; expiresAt: string };
}

export class SeedError extends Error {
  override name = "SeedError";
}

export const USAGE = `Usage: bun scripts/seed.ts --email <owner email> [options]
  --url <origin>       office URL (default $OFFICE_URL, $OFFICE_PUBLIC_URL or ${DEFAULT_URL})
  --email <email>      owner email ($SEED_OWNER_EMAIL)
  --name <name>        owner display name ($SEED_OWNER_NAME, default "Owner")
  --password <pw>      owner password ($SEED_OWNER_PASSWORD); generated if creating the owner
  --role <role>        invite role: member, admin, viewer, owner ($SEED_INVITE_ROLE, default member)
  --insecure           accept self-signed TLS (default on for localhost)
  --json               print the result as JSON`;

type Env = Record<string, string | undefined>;

/** Flags win over env; throws {@link SeedError} on missing or invalid input. */
export function parseSeedArgs(argv: string[], env: Env = process.env): SeedOptions | "help" {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      email: { type: "string" },
      name: { type: "string" },
      password: { type: "string" },
      role: { type: "string" },
      insecure: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) return "help";
  const pick = (flag: string | undefined, ...keys: string[]) => {
    const v = flag ?? keys.map((k) => env[k]).find((x) => x !== undefined && x.trim() !== "");
    return v?.trim() || undefined;
  };
  const rawUrl = pick(values.url, "OFFICE_URL", "OFFICE_PUBLIC_URL") ?? DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SeedError(`--url is not a URL: ${rawUrl}`);
  }
  const email = pick(values.email, "SEED_OWNER_EMAIL");
  if (!email) throw new SeedError(`--email (or SEED_OWNER_EMAIL) is required\n${USAGE}`);
  const role = pick(values.role, "SEED_INVITE_ROLE") ?? "member";
  if (!isUserRole(role)) throw new SeedError(`--role must be owner, admin, member or viewer`);
  return {
    url: url.origin,
    email,
    name: pick(values.name, "SEED_OWNER_NAME") ?? "Owner",
    password: values.password ?? (env.SEED_OWNER_PASSWORD || undefined),
    role,
    insecure: values.insecure ?? LOCAL_HOSTS.has(url.hostname),
    json: values.json ?? false,
  };
}

/** 18 random bytes, base64url: 24 characters, well above the 8-character minimum. */
export function generatePassword(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
}

type Fetch = typeof fetch;

/** A cookie-carrying client that sends the office origin like a browser would (CSRF checks). */
function officeClient(opts: SeedOptions, fetchFn: Fetch) {
  const jar = new Map<string, string>();
  return async function call(path: string, body?: unknown): Promise<Response> {
    const headers = new Headers({ origin: opts.url, accept: "application/json" });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (jar.size > 0) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    };
    if (opts.insecure) init.tls = { rejectUnauthorized: false };
    let res: Response;
    try {
      res = await fetchFn(new URL(path, opts.url), init);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new SeedError(`cannot reach the office at ${opts.url}: ${why}`);
    }
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const value = pair.slice(eq + 1);
      if (value === "" || /max-age=0/i.test(c)) jar.delete(pair.slice(0, eq));
      else jar.set(pair.slice(0, eq), value);
    }
    return res;
  };
}

async function expectOk<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const b = JSON.parse(text) as { code?: string; error?: string; message?: string };
      detail = [b.code ?? b.error, b.message].filter(Boolean).join(": ") || detail;
    } catch {}
    throw new SeedError(`${what} failed (HTTP ${res.status}): ${detail}`);
  }
  return JSON.parse(text) as T;
}

export async function seed(opts: SeedOptions, fetchFn: Fetch = fetch): Promise<SeedResult> {
  const call = officeClient(opts, fetchFn);
  const config = await expectOk<{ hasUsers: boolean }>(
    await call("/api/auth-config"),
    "reading /api/auth-config",
  );

  let ownerCreated = false;
  let generatedPassword: string | undefined;
  if (!config.hasUsers) {
    const password = opts.password ?? generatePassword();
    if (!opts.password) generatedPassword = password;
    await expectOk(
      await call("/api/auth/sign-up/email", { email: opts.email, password, name: opts.name }),
      "creating the owner",
    );
    ownerCreated = true;
  } else {
    if (!opts.password)
      throw new SeedError(
        "this office already has users, so seed will not create another owner. " +
          "To mint an invite, pass --email and --password of an existing owner or admin.",
      );
    await expectOk(
      await call("/api/auth/sign-in/email", { email: opts.email, password: opts.password }),
      `signing in as ${opts.email}`,
    );
  }

  const me = await expectOk<{ role: string }>(await call("/api/me"), "reading /api/me");
  const invite = await expectOk<SeedResult["invite"]>(
    await call("/api/invites", { role: opts.role }),
    `creating a ${opts.role} invite as ${me.role}`,
  );
  return {
    ownerCreated,
    generatedPassword,
    actor: { email: opts.email, role: me.role },
    invite: { url: invite.url, role: invite.role, expiresAt: invite.expiresAt },
  };
}

export function formatResult(r: SeedResult): string {
  const lines = [
    r.ownerCreated
      ? `Created owner ${r.actor.email}.`
      : `Office already has users; signed in as ${r.actor.email} (${r.actor.role}), no owner created.`,
  ];
  if (r.generatedPassword)
    lines.push(`Generated password (shown once, not stored): ${r.generatedPassword}`);
  lines.push(`Invite (${r.invite.role}, expires ${r.invite.expiresAt}):`, `  ${r.invite.url}`);
  return lines.join("\n");
}

async function main(): Promise<number> {
  try {
    const opts = parseSeedArgs(process.argv.slice(2));
    if (opts === "help") {
      console.log(USAGE);
      return 0;
    }
    const result = await seed(opts);
    console.log(opts.json ? JSON.stringify(result, null, 2) : formatResult(result));
    return 0;
  } catch (err) {
    if (err instanceof SeedError || (err instanceof Error && "code" in err)) {
      console.error(`seed: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

if (import.meta.main) process.exit(await main());
