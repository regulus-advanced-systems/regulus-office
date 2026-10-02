import { describe, expect, test } from "bun:test";
import { mediaGrantsFor } from "@regulus/protocol";
import { mintAccessToken, verifyAccessToken } from "./token.ts";

const SECRET = "s".repeat(40);
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

const mint = (role: "owner" | "member" | "viewer", now = NOW) =>
  mintAccessToken({
    apiKey: "APIkey123",
    apiSecret: SECRET,
    identity: "session-1",
    name: "Ada",
    room: "office",
    grants: mediaGrantsFor(role),
    ttlSeconds: 600,
    now,
  });

const decode = (token: string) =>
  token
    .split(".")
    .slice(0, 2)
    .map((part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")));

describe("LiveKit access tokens (#48)", () => {
  test("an HS256 JWT in livekit-server's claim layout", () => {
    const { token, expiresAt } = mint("member");
    const [header, claims] = decode(token);
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(claims.iss).toBe("APIkey123");
    expect(claims.sub).toBe("session-1");
    expect(claims.name).toBe("Ada");
    expect(claims.exp).toBe(NOW / 1000 + 600);
    expect(expiresAt).toBe(NOW + 600_000);
    expect(claims.nbf).toBeLessThanOrEqual(NOW / 1000);
    expect(claims.video).toEqual({
      room: "office",
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      canPublishSources: ["microphone", "screen_share", "screen_share_audio"],
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
  });

  test("a viewer's token may subscribe but not publish", () => {
    const [, claims] = decode(mint("viewer").token);
    expect(claims.video.canSubscribe).toBe(true);
    expect(claims.video.canPublish).toBe(false);
    expect(claims.video.canPublishSources).toEqual([]);
  });

  test("the signature checks out with the secret only, and the token expires", () => {
    const { token } = mint("owner");
    expect(verifyAccessToken(token, SECRET, NOW)?.sub).toBe("session-1");
    expect(verifyAccessToken(token, "x".repeat(40), NOW)).toBeNull();
    expect(verifyAccessToken(token, SECRET, NOW + 599_000)).not.toBeNull();
    expect(verifyAccessToken(token, SECRET, NOW + 600_000)).toBeNull();
    const [h, b] = token.split(".");
    const tampered = Buffer.from(b as string, "base64url")
      .toString("utf8")
      .replace('"canPublish":true', '"canPublish":false');
    expect(
      verifyAccessToken(
        `${h}.${Buffer.from(tampered).toString("base64url")}.${token.split(".")[2]}`,
        SECRET,
        NOW,
      ),
    ).toBeNull();
  });

  test("refuses to mint without a key pair or identity", () => {
    const base = {
      apiKey: "k",
      apiSecret: SECRET,
      identity: "i",
      name: "n",
      room: "office",
      grants: mediaGrantsFor("member"),
      ttlSeconds: 60,
      now: NOW,
    };
    expect(() => mintAccessToken({ ...base, apiSecret: "" })).toThrow();
    expect(() => mintAccessToken({ ...base, apiKey: "" })).toThrow();
    expect(() => mintAccessToken({ ...base, identity: "" })).toThrow();
  });
});
