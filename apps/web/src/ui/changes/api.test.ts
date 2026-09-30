import { describe, expect, test } from "bun:test";
import { createChangesApi } from "./api.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function fetchReturning(res: Response, seen: string[] = []) {
  return (async (input: string | URL | Request) => {
    seen.push(String(input));
    return res.clone();
  }) as typeof fetch;
}

describe("changes api", () => {
  test("image bytes are accepted only when they are a raster image", async () => {
    const seen: string[] = [];
    const ok = createChangesApi({ fetch: fetchReturning(new Response(PNG), seen) });
    const res = await ok.image("a1", "img/a b.png", "work");
    expect(res.ok && res.data.type).toBe("image/png");
    expect(seen[0]).toBe("/api/agents/a1/changes/blob?path=img%2Fa+b.png&side=work");

    const html = new TextEncoder().encode("<svg onload=alert(1)></svg>");
    const bad = createChangesApi({ fetch: fetchReturning(new Response(html)) });
    const refused = await bad.image("a1", "x.png", "work");
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.code).toBe("not_image");
  });

  test("errors carry the server's code, message and files", async () => {
    const body = { error: "changed_since_viewed", message: "m", files: ["a.ts", 3] };
    const api = createChangesApi({
      fetch: fetchReturning(new Response(JSON.stringify(body), { status: 409 })),
    });
    const res = await api.commit("a1", "msg", [{ path: "a.ts", sig: "s" }]);
    expect(res).toEqual({
      ok: false,
      status: 409,
      code: "changed_since_viewed",
      message: "m",
      files: ["a.ts"],
    });
  });

  test("an answer that does not match the schema is rejected", async () => {
    const api = createChangesApi({
      fetch: fetchReturning(new Response(JSON.stringify({ nope: 1 }))),
    });
    const res = await api.snapshot("a1");
    expect(!res.ok && res.code).toBe("unexpected_response");
  });

  test("network failures", async () => {
    const api = createChangesApi({
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    expect(!(await api.snapshot("a1")).ok).toBe(true);
  });
});
