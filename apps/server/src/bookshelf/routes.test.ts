/**
 * Bookshelf REST (#264): status codes and bodies, a closed room answering
 * exactly as a missing one, and the headers that keep a repo's file from
 * ever being a page on the office's origin.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type BookshelfListing,
  bookshelfApiPath,
  bookshelfDocApiPath,
  bookshelfImageApiPath,
  bookshelfSearchApiPath,
} from "@regulus/protocol";
import type { SessionUser } from "../auth/auth.ts";
import { Router } from "../http/router.ts";
import { mountBookshelfRoutes } from "./routes.ts";
import { type ShelfOffice, startShelfOffice } from "./test-helpers.ts";

let office: ShelfOffice;
let router: Router;
const people = new Map<string, { id: string; role: SessionUser["role"] }>();

beforeAll(() => {
  office = startShelfOffice();
  people.set("reader", office.person("Rita", "viewer", "read"));
  people.set("outsider", office.person("Otto", "member"));
  people.set("admin", office.person("Ada", "admin"));
  router = new Router();
  mountBookshelfRoutes(router, {
    bookshelf: office.bookshelf,
    auth: {
      // The session is the test's header; everything after it is the real route.
      getSessionFromRequest: async (request) =>
        (people.get(request.headers.get("x-test-user") ?? "") as SessionUser | undefined) ?? null,
    },
  });
});
afterAll(() => office.stop());

async function get(who: string | null, path: string, headers: Record<string, string> = {}) {
  const url = new URL(path, "http://office.test");
  const match = router.match("GET", url.pathname);
  if (!match) throw new Error(`no route for ${path}`);
  const request = new Request(url, {
    headers: { ...(who ? { "x-test-user": who } : {}), ...headers },
  });
  return match.handler({ request, url, params: match.params });
}

const ROUTES = (room: string) => [
  bookshelfApiPath(room),
  bookshelfDocApiPath(room, "README.md"),
  bookshelfDocApiPath(room, "../../etc/passwd"),
  `${bookshelfApiPath(room)}/file`,
  bookshelfImageApiPath(room, "docs/img/ok.png"),
  bookshelfSearchApiPath(room, "needle-one"),
  `${bookshelfApiPath(room)}/search`,
];

describe("bookshelf routes", () => {
  test("the routes are these four GETs and nothing that writes", () => {
    expect(router.table.map((r) => `${r.method} ${r.pattern}`)).toEqual([
      "GET /api/operations/:operationId/docs",
      "GET /api/operations/:operationId/docs/file",
      "GET /api/operations/:operationId/docs/search",
      "GET /api/operations/:operationId/docs/image",
    ]);
  });

  test("no session: 401 on every route", async () => {
    for (const path of ROUTES("alpha")) expect((await get(null, path)).status).toBe(401);
  });

  test("a closed room and a missing room answer the same 404, whatever is asked", async () => {
    for (const who of ["outsider", "admin"]) {
      const closed = ROUTES("alpha");
      const missing = ROUTES("no-such-room");
      for (const [i, path] of closed.entries()) {
        const a = await get(who, path, { "if-none-match": '"anything"' });
        const b = await get(who, missing[i] as string, { "if-none-match": '"anything"' });
        expect(a.status).toBe(404);
        expect(b.status).toBe(404);
        expect(await a.text()).toBe('{"error":"not_found"}');
        expect(await b.text()).toBe('{"error":"not_found"}');
        expect([...a.headers]).toEqual([...b.headers]);
      }
    }
  });

  test("a reader (view access is enough) gets the shelf, a document and search hits as JSON", async () => {
    const shelf = await get("reader", bookshelfApiPath("alpha"));
    expect(shelf.status).toBe(200);
    expect(shelf.headers.get("cache-control")).toBe("private, no-store");
    expect(((await shelf.json()) as BookshelfListing).docs[0]?.path).toBe("README.md");

    const doc = await get("reader", bookshelfDocApiPath("alpha", "docs/guide.md"));
    expect(doc.status).toBe(200);
    expect(doc.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(((await doc.json()) as { markdown: string }).markdown).toContain("# Guide");

    const found = await get("reader", bookshelfSearchApiPath("alpha", "needle-one"));
    expect(((await found.json()) as { hits: unknown[] }).hits).toHaveLength(2);
  });

  test("refusals carry their reason and status", async () => {
    const cases: [string, number, string][] = [
      [bookshelfDocApiPath("alpha", "../../etc/passwd"), 400, "bad_path"],
      [bookshelfDocApiPath("alpha", "/etc/passwd"), 400, "bad_path"],
      [`${bookshelfApiPath("alpha")}/file`, 400, "bad_path"],
      [`${bookshelfApiPath("alpha")}/file?path=a&path=README.md`, 404, "not_found"],
      [bookshelfDocApiPath("alpha", "passwd.md"), 404, "not_found"],
      [bookshelfDocApiPath("alpha", "docs/big.md"), 413, "too_large"],
      [bookshelfDocApiPath("alpha", "docs/binary.md"), 415, "not_text"],
      [bookshelfImageApiPath("alpha", "docs/img/fake.png"), 415, "not_image"],
      [bookshelfImageApiPath("alpha", "docs/img/drawing.svg"), 404, "not_found"],
      [bookshelfImageApiPath("alpha", "docs/img/escape.png"), 404, "not_found"],
      [bookshelfSearchApiPath("alpha", "x"), 400, "bad_query"],
    ];
    for (const [path, status, code] of cases) {
      const res = await get("reader", path);
      expect([path, res.status, await res.json()]).toEqual([path, status, { error: code }]);
    }
  });

  test("a picture goes out as an inert image: its real type, nosniff, sandboxed, same-origin", async () => {
    const res = await get("reader", bookshelfImageApiPath("alpha", "docs/img/ok.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    const etag = res.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    expect(new Uint8Array(await res.arrayBuffer()).subarray(1, 4)).toEqual(
      new Uint8Array([0x50, 0x4e, 0x47]),
    );
    // Revalidation is answered only after the gate: 304 for the reader, 404 for anyone else.
    const again = await get("reader", bookshelfImageApiPath("alpha", "docs/img/ok.png"), {
      "if-none-match": etag,
    });
    expect(again.status).toBe(304);
    const other = await get("outsider", bookshelfImageApiPath("alpha", "docs/img/ok.png"), {
      "if-none-match": etag,
    });
    expect(other.status).toBe(404);
  });
});
