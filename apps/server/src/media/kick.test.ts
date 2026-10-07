/** Removing a media participant (#244): the request LiveKit's RoomService expects. */
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { SecretValue } from "../config.ts";
import type { MediaConfig } from "./config.ts";
import { mintRoomAdminToken, removeParticipant, removeParticipantUrl } from "./kick.ts";

const config: MediaConfig = {
  url: "wss://office.example/livekit",
  apiKey: "APIkey",
  apiSecret: new SecretValue("secret-secret-secret"),
  room: "office",
};

describe("removeParticipantUrl", () => {
  test("is the RoomService endpoint on the signalling address", () => {
    expect(removeParticipantUrl("wss://office.example/livekit")).toBe(
      "https://office.example/livekit/twirp/livekit.RoomService/RemoveParticipant",
    );
    expect(removeParticipantUrl("ws://127.0.0.1:7880")).toBe(
      "http://127.0.0.1:7880/twirp/livekit.RoomService/RemoveParticipant",
    );
  });
});

describe("removeParticipant", () => {
  test("posts the identity with a short-lived room admin token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await removeParticipant(config, "seat-1", {
      fetch: fakeFetch,
      now: () => 1_000_000,
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] as (typeof calls)[number];
    expect(url).toBe("https://office.example/livekit/twirp/livekit.RoomService/RemoveParticipant");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ room: "office", identity: "seat-1" });
    const token = (init.headers as Record<string, string>).authorization?.replace("Bearer ", "");
    const [head, body, sig] = (token ?? "").split(".");
    const expected = createHmac("sha256", "secret-secret-secret")
      .update(`${head}.${body}`)
      .digest("base64url");
    expect(sig).toBe(expected);
    const claims = JSON.parse(Buffer.from(body ?? "", "base64url").toString("utf8"));
    expect(claims).toMatchObject({ iss: "APIkey", video: { room: "office", roomAdmin: true } });
    expect(claims.exp - 1000).toBeLessThanOrEqual(60);
    expect(claims.video.roomJoin).toBeUndefined();
  });

  test("someone who is not connected counts as removed; an unreachable LiveKit does not", async () => {
    const answer = (status: number) =>
      (async () => new Response("", { status })) as unknown as typeof fetch;
    expect(await removeParticipant(config, "x", { fetch: answer(404) })).toBe(true);
    expect(await removeParticipant(config, "x", { fetch: answer(401) })).toBe(false);
    const down = (async () => {
      throw new Error("connect refused");
    }) as unknown as typeof fetch;
    expect(await removeParticipant(config, "x", { fetch: down })).toBe(false);
  });

  test("the admin token is signed with the API secret and names it nowhere", () => {
    const token = mintRoomAdminToken(config, 0);
    expect(token).not.toContain("secret-secret-secret");
    expect(token.split(".")).toHaveLength(3);
  });
});
