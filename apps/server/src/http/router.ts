/**
 * Minimal method + path router for Bun.serve. Patterns are literal segments,
 * `:param` captures, or a trailing `*` that swallows one or more remaining
 * segments (available as `params["*"]`); the matched pattern doubles as the
 * bounded-cardinality `route` label for metrics.
 */

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export interface RouteContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
}

export type RouteHandler = (ctx: RouteContext) => Response | Promise<Response>;

export interface RouteMatch {
  pattern: string;
  handler: RouteHandler;
  params: Record<string, string>;
}

interface Route {
  method: HttpMethod;
  pattern: string;
  segments: string[];
  handler: RouteHandler;
}

const split = (path: string): string[] => path.split("/").filter((s) => s.length > 0);

export class Router {
  readonly #routes: Route[] = [];

  add(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    if (!pattern.startsWith("/")) throw new Error(`route pattern must start with "/": ${pattern}`);
    this.#routes.push({ method, pattern, segments: split(pattern), handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.add("GET", pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): this {
    return this.add("POST", pattern, handler);
  }

  /** Finds the first route whose method and pattern match. HEAD falls back to GET routes. */
  match(method: string, pathname: string): RouteMatch | undefined {
    const wanted = method.toUpperCase();
    const segments = split(pathname);
    for (const route of this.#routes) {
      if (route.method !== wanted && !(wanted === "HEAD" && route.method === "GET")) continue;
      const params = matchSegments(route.segments, segments);
      if (params) return { pattern: route.pattern, handler: route.handler, params };
    }
    return undefined;
  }

  /** True if any route matches the path regardless of method (used for 405 vs fallthrough). */
  hasPath(pathname: string): boolean {
    const segments = split(pathname);
    return this.#routes.some((r) => matchSegments(r.segments, segments) !== undefined);
  }
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | undefined {
  const wildcard = pattern.at(-1) === "*";
  if (wildcard ? actual.length < pattern.length : pattern.length !== actual.length)
    return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i] as string;
    const a = actual[i] as string;
    if (wildcard && i === pattern.length - 1) {
      params["*"] = actual.slice(i).join("/");
    } else if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(a);
    } else if (p !== a) {
      return undefined;
    }
  }
  return params;
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}
