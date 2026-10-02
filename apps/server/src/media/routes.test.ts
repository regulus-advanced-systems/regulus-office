/** Media token minting over a real server with sessions (#48). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  MEDIA_STATUS_API_PATH,
  MEDIA_TOKEN_API_PATH,
  MEDIA_TOKEN_TTL_SECONDS,
  type MediaStatus,
  type MediaToken,
} from "@regulus/protocol";
import { type Office, startOffice } from "../auth/test-helpers.ts";
import { SecretValue } from "../config.ts";
import { createLogger } from "../logging.ts";
import type { MediaConfig } from "./config.ts";
import { mountMediaRoutes } from "./routes.ts";
import { verifyAccessToken } from "./token.ts";

const SECRET = "test-livekit-secret-0123456789abcdef";
const NOW = Date.UTC(2026, 9, 2, 9, 0, 0);
const config: MediaConfig = {
  url: "wss://office.example/livekit",
  apiKey: "APItest",
  apiSecret: new SecretValue(SECRET),
  room: "office",
};

/** Connected building sessions: session id → user id. */
const sessions = new Map<string, string>();
const logged: unknown[] = [];

let office: Office;
let bare: Office;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let viewer: { id: string; cookie: string };
let bareUser: { id: string; cookie: string };

beforeAll(async () => {
  office = startOffice();
  const logger = createLogger({ level: "trace" });
  const spy = new Proxy(logger, {
    get(target, prop, receiver) {
      if (["debug", "info", "warn", "error", "trace"].includes(String(prop)))
        return (...args: unknown[]) => logged.push(args);
      return Reflect.get(target, prop, receiver);
    },
  });
  mountMediaRoutes(office.server.router, {
    auth: office.auth,
    config,
    presence: (id) => {
      const userId = sessions.get(id);
      return userId ? { userId } : null;
    },
    logger: spy,
    now: () => NOW,
  });
  owner = await office.signUp("Olga");
  member = await office.signUp("Mia");
  viewer = await office.signUp("Vic");
  office.db.$client.run(`update user_profiles set role = 'viewer' where user_id = '${viewer.id}'`);
  sessions.set("s-owner", owner.id);
  sessions.set("s-member", member.id);
  sessions.set("s-viewer", viewer.id);

  bare = startOffice();
  mountMediaRoutes(bare.server.router, {
    auth: bare.auth,
    config: null,
    presence: () => null,
    logger: createLogger({ level: "silent" }),
  });
  bareUser = await bare.signUp("Bo");
});

afterAll(async () => {
  await office.stop();
  await bare.stop();
});

const token = (o: Office, cookie: string | undefined, body: unknown, origin?: string) =>
  o.request(MEDIA_TOKEN_API_PATH, {
    method: "POST",
    cookie,
    body: JSON.stringify(body),
    headers: origin ? { origin } : undefined,
  });

describe("media status", () => {
  test("signed-in humans learn whether media is on and whether they may publish", async () => {
    expect((await office.request(MEDIA_STATUS_API_PATH)).status).toBe(401);
    const of = async (o: Office, cookie: string) =>
      (await (await o.request(MEDIA_STATUS_API_PATH, { cookie })).json()) as MediaStatus;
    expect(await of(office, member.cookie)).toEqual({ enabled: true, canPublish: true });
    expect(await of(office, viewer.cookie)).toEqual({ enabled: true, canPublish: false });
    expect(await of(bare, bareUser.cookie)).toEqual({ enabled: false, canPublish: false });
  });
});

describe("media tokens (#48)", () => {
  test("refused without a session", async () => {
    const res = await token(office, undefined, { sessionId: "s-member" });
    expect(res.status).toBe(401);
  });

  test("refused from another origin", async () => {
    const res = await token(
      office,
      member.cookie,
      { sessionId: "s-member" },
      "https://evil.example",
    );
    expect(res.status).toBe(403);
  });

  test("refused when media is not configured", async () => {
    const res = await token(bare, bareUser.cookie, { sessionId: "anything" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "media_not_configured" });
  });

  test("refused for a session that is not the caller's, or not connected", async () => {
    expect((await token(office, member.cookie, { sessionId: "s-owner" })).status).toBe(403);
    expect((await token(office, member.cookie, { sessionId: "gone" })).status).toBe(403);
    const bad = await token(office, member.cookie, { nope: 1 });
    expect(bad.status).toBe(400);
  });

  test("a member's token: own session as identity, publish mic and screen, short-lived", async () => {
    const res = await token(office, member.cookie, { sessionId: "s-member" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as MediaToken;
    expect(body.url).toBe(config.url);
    expect(body.identity).toBe("s-member");
    expect(body.expiresAt).toBe(NOW + MEDIA_TOKEN_TTL_SECONDS * 1000);
    const claims = verifyAccessToken(body.token, SECRET, NOW);
    expect(claims?.sub).toBe("s-member");
    expect(claims?.name).toBe("Mia");
    expect(claims?.video.room).toBe("office");
    expect(claims?.video.canPublish).toBe(true);
    expect(claims?.video.canPublishSources).toEqual([
      "microphone",
      "screen_share",
      "screen_share_audio",
    ]);
    expect(claims?.video.canPublishData).toBe(false);
    expect(verifyAccessToken(body.token, SECRET, body.expiresAt)).toBeNull();
  });

  test("a viewer's token subscribes only", async () => {
    const body = (await (
      await token(office, viewer.cookie, { sessionId: "s-viewer" })
    ).json()) as MediaToken;
    const claims = verifyAccessToken(body.token, SECRET, NOW);
    expect(claims?.video.canSubscribe).toBe(true);
    expect(claims?.video.canPublish).toBe(false);
    expect(claims?.video.canPublishSources).toEqual([]);
  });

  test("neither the token nor the secret is logged", async () => {
    const body = (await (
      await token(office, owner.cookie, { sessionId: "s-owner" })
    ).json()) as MediaToken;
    const all = JSON.stringify(logged);
    expect(all).not.toContain(body.token);
    expect(all).not.toContain(SECRET);
  });
});
