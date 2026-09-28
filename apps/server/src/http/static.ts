/**
 * Serves the built web client (apps/web/dist) with an SPA fallback to
 * index.html. When the build is absent every page request gets a JSON 503
 * that says how to produce it, so a fresh checkout fails loudly, not blankly.
 */
import { resolve, sep } from "node:path";
import { json } from "./router.ts";

export interface StaticOptions {
  /** Absolute path to the dist directory. */
  distDir: string;
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";

/** Resolves `pathname` under `distDir`, or undefined if it escapes the directory. */
export function resolveWithin(distDir: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const root = resolve(distDir);
  const full = resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  if (full !== root && !full.startsWith(root + sep)) return undefined;
  return full;
}

export function webBuildMissingResponse(distDir: string): Response {
  return json(
    {
      error: "web_build_missing",
      message: `The web client build was not found at ${distDir}. Run "bun run --filter @regulus/web build" (or set OFFICE_WEB_DIST) and reload.`,
    },
    { status: 503, headers: { "cache-control": NO_CACHE } },
  );
}

/** True if the request would accept an HTML document (SPA fallback candidates). */
const wantsHtml = (request: Request): boolean => {
  const accept = request.headers.get("accept") ?? "";
  return accept === "" || accept.includes("text/html") || accept.includes("*/*");
};

const hasExtension = (pathname: string): boolean => /\.[a-zA-Z0-9]+$/.test(pathname);

export function createStaticHandler(options: StaticOptions) {
  const distDir = resolve(options.distDir);
  const index = resolve(distDir, "index.html");

  return async (request: Request, url: URL): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(
        { error: "method_not_allowed" },
        { status: 405, headers: { allow: "GET, HEAD" } },
      );
    }
    const target = resolveWithin(distDir, url.pathname);
    if (!target) return json({ error: "not_found" }, { status: 404 });

    const indexFile = Bun.file(index);
    if (!(await indexFile.exists())) return webBuildMissingResponse(distDir);

    if (target !== distDir) {
      const file = Bun.file(target);
      if (await file.exists()) {
        const immutable = url.pathname.startsWith("/assets/");
        return fileResponse(request, file, immutable ? IMMUTABLE : NO_CACHE);
      }
    }
    if (hasExtension(url.pathname) || !wantsHtml(request)) {
      return json({ error: "not_found" }, { status: 404 });
    }
    return fileResponse(request, indexFile, NO_CACHE);
  };
}

function fileResponse(request: Request, file: Bun.BunFile, cacheControl: string): Response {
  const headers = { "cache-control": cacheControl, "content-type": file.type };
  if (request.method === "HEAD") {
    return new Response(null, { headers: { ...headers, "content-length": String(file.size) } });
  }
  return new Response(file, { headers });
}
