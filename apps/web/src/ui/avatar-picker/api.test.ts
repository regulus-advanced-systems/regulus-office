import { describe, expect, test } from "bun:test";
import { DEFAULT_GENIUS_LOOK, GENIUS_AVATAR_API_PATH } from "@regulus/protocol/src/genius.ts";
import { saveGeniusLook } from "./api.ts";

const respond = (status: number, body: unknown, seen: unknown[] = []) =>
  (async (url: string, init?: RequestInit) => {
    seen.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

describe("saveGeniusLook", () => {
  const look = { ...DEFAULT_GENIUS_LOOK, archetype: "general", accessory: "medals" } as const;

  test("PUTs the look and returns what the server stored", async () => {
    const seen: unknown[] = [];
    const result = await saveGeniusLook(
      look,
      respond(200, { avatar: look, avatarChosen: true }, seen),
    );
    expect(result).toEqual({ ok: true, look });
    expect(seen).toEqual([{ url: GENIUS_AVATAR_API_PATH, method: "PUT", body: look }]);
  });

  test("turns refusals and network failures into messages", async () => {
    const invalid = await saveGeniusLook(
      look,
      respond(400, { error: "invalid_body", fields: ["accessory"] }),
    );
    expect(invalid).toEqual({ ok: false, error: "That combination is not available. Pick again." });
    expect((await saveGeniusLook(look, respond(401, {}))).ok).toBe(false);
    const offline = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await saveGeniusLook(look, offline)).toMatchObject({ ok: false });
  });
});
