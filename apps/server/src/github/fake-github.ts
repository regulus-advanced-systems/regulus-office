/**
 * A fake GitHub REST API for tests (#141): app installations and installation
 * tokens (checking the app JWT's RS256 signature), installation and PAT repo
 * lists, and the manifest conversion. Listens on 127.0.0.1 only; nothing here
 * talks to the real GitHub. Only imported by tests.
 */
import { createVerify, generateKeyPairSync, type KeyObject } from "node:crypto";

export interface FakeRepo {
  owner: string;
  name: string;
  private?: boolean;
  defaultBranch?: string;
}

export interface FakeInstallation {
  id: number;
  account: string;
  repos: FakeRepo[];
}

export interface RecordedCall {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

export function testAppKey(): { privateKey: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(), publicKey };
}

const raw = (r: FakeRepo) => ({
  name: r.name,
  full_name: `${r.owner}/${r.name}`,
  owner: { login: r.owner },
  private: r.private ?? true,
  default_branch: r.defaultBranch ?? "main",
  pushed_at: "2026-09-01T10:00:00Z",
  description: `${r.name} repo`,
});

export function startFakeGitHub(opts: {
  appId?: number;
  publicKey?: KeyObject;
  installations?: FakeInstallation[];
  /** Fine-grained PATs and the repos each can see. */
  pats?: Record<string, { login: string; repos: FakeRepo[] }>;
  /** Manifest conversion: code → payload. */
  conversions?: Record<string, Record<string, unknown>>;
  /** Installation token lifetime (ms from now). */
  tokenTtlMs?: number;
  /** `GET /app` slug and the app's webhook config (#35); absent config answers 404. */
  appSlug?: string;
  hookConfig?: Record<string, unknown>;
  /** More of `GET /app` (#224): name, owner, client id, permissions, events. */
  app?: Record<string, unknown>;
  /** When set, the JWT's `iss` must be one of these (the app id or client id). */
  issuers?: string[];
  /** More routes (the boards fake, #35); undefined falls through to 404. */
  extra?: (req: Request, url: URL, body: unknown) => Response | undefined;
}) {
  const calls: RecordedCall[] = [];
  /** Minted installation token → installation id and repo scope. */
  const minted = new Map<string, { installation: FakeInstallation; repo: string | null }>();
  let seq = 0;
  const state = { failAll: false, hookConfig: opts.hookConfig ?? null };

  const verifyJwt = (auth: string | null): boolean => {
    const jwt = auth?.replace(/^Bearer /, "") ?? "";
    const [h, p, sig] = jwt.split(".");
    if (!h || !p || !sig || !opts.publicKey) return false;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    if (!verifier.verify(opts.publicKey, Buffer.from(sig, "base64url"))) return false;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as {
      iat: number;
      exp: number;
      iss: string;
    };
    if (opts.issuers && !opts.issuers.includes(claims.iss)) return false;
    return claims.exp - claims.iat <= 660 && claims.iss !== "";
  };

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const text = await req.text();
      const body = text ? (JSON.parse(text) as unknown) : null;
      const authorization = req.headers.get("authorization");
      calls.push({ method: req.method, path: url.pathname + url.search, authorization, body });
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "30");
      const slice = <T>(list: T[]) => list.slice((page - 1) * perPage, page * perPage);
      if (state.failAll) return Response.json({ message: "Server Error" }, { status: 500 });

      if (url.pathname === "/app/installations") {
        if (!verifyJwt(authorization))
          return Response.json({ message: "Bad JWT" }, { status: 401 });
        return Response.json(
          slice(opts.installations ?? []).map((i) => ({
            id: i.id,
            account: { login: i.account },
            repository_selection: "selected",
          })),
        );
      }
      const tokenMatch = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
      if (tokenMatch && req.method === "POST") {
        if (!verifyJwt(authorization))
          return Response.json({ message: "Bad JWT" }, { status: 401 });
        const inst = opts.installations?.find((i) => i.id === Number(tokenMatch[1]));
        if (!inst) return Response.json({ message: "Not Found" }, { status: 404 });
        const wanted = (body as { repositories?: string[] } | null)?.repositories?.[0] ?? null;
        if (wanted && !inst.repos.some((r) => r.name.toLowerCase() === wanted.toLowerCase())) {
          return Response.json(
            {
              message: "There is at least one repository that does not exist or is not accessible",
            },
            { status: 422 },
          );
        }
        seq += 1;
        const token = `ghs_fakeInstallationToken${seq}x${inst.id}`;
        minted.set(token, { installation: inst, repo: wanted });
        const expires = new Date(Date.now() + (opts.tokenTtlMs ?? 3_600_000)).toISOString();
        return Response.json({ token, expires_at: expires }, { status: 201 });
      }
      if (url.pathname === "/installation/repositories") {
        const entry = minted.get(authorization?.replace(/^Bearer /, "") ?? "");
        if (!entry) return Response.json({ message: "Bad credentials" }, { status: 401 });
        const repos = slice(entry.installation.repos).map(raw);
        return Response.json({ total_count: entry.installation.repos.length, repositories: repos });
      }
      const pat = opts.pats?.[authorization?.replace(/^Bearer /, "") ?? ""];
      if (url.pathname === "/user") {
        if (!pat) return Response.json({ message: "Bad credentials" }, { status: 401 });
        return Response.json({ login: pat.login });
      }
      if (url.pathname === "/user/repos") {
        if (!pat) return Response.json({ message: "Bad credentials" }, { status: 401 });
        return Response.json(slice(pat.repos).map(raw));
      }
      if (url.pathname === "/app" || url.pathname === "/app/hook/config") {
        if (!verifyJwt(authorization))
          return Response.json({ message: "Bad JWT" }, { status: 401 });
        if (url.pathname === "/app")
          return Response.json({ id: opts.appId ?? 1, slug: opts.appSlug, ...opts.app });
        if (req.method === "PATCH") {
          state.hookConfig = { ...(state.hookConfig ?? {}), ...(body as object) };
        } else if (!state.hookConfig) {
          return Response.json({ message: "Not Found" }, { status: 404 });
        }
        const { secret: _secret, ...shown } = state.hookConfig ?? {};
        return Response.json(shown);
      }
      const conv = /^\/app-manifests\/([^/]+)\/conversions$/.exec(url.pathname);
      if (conv && req.method === "POST") {
        const payload = opts.conversions?.[decodeURIComponent(conv[1] ?? "")];
        if (!payload) return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json(payload, { status: 201 });
      }
      const extra = opts.extra?.(req, url, body);
      if (extra) return extra;
      return Response.json({ message: "Not Found" }, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    calls,
    minted,
    state,
    stop: () => server.stop(true),
  };
}

export type FakeGitHubServer = ReturnType<typeof startFakeGitHub>;
