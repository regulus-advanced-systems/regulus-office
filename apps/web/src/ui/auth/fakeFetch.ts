/**
 * Test double for `fetch`: routes "METHOD /path" to canned JSON responses and
 * records every call. Only imported by tests.
 */
export interface FakeCall {
  method: string;
  path: string;
  /** The query string with its "?", or "". */
  search: string;
  body: unknown;
  init: RequestInit | undefined;
}

export type FakeHandler = (call: FakeCall) => { status?: number; body?: unknown } | undefined;

export function fakeFetch(
  routes: Record<string, FakeHandler | { status?: number; body?: unknown }>,
) {
  const calls: FakeCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method, path: url.pathname, search: url.search, body, init };
    calls.push(call);
    const route = routes[`${method} ${url.pathname}`];
    const out = typeof route === "function" ? route(call) : route;
    if (!out) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), {
      status: out.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}
