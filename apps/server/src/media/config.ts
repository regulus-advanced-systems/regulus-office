/**
 * LiveKit settings from the environment (#48, deploy/.env.example):
 *
 * - LIVEKIT_API_KEY, LIVEKIT_API_SECRET: the key pair livekit-server is
 *   started with (scripts/setup.sh --media generates both into deploy/.env).
 *   Both empty: media is off and the office works without it (voice and the
 *   TV share are hidden). Only one set is a mistake and stops the server.
 * - LIVEKIT_URL: where browsers reach LiveKit's signalling. Default: the
 *   office's own origin under `/livekit` (Caddy proxies it to the `livekit`
 *   service), so no extra hostname or certificate is needed.
 *
 * The secret is wrapped in SecretValue so it never reaches a log line.
 */
import { MEDIA_ROOM } from "@regulus/protocol";
import { SecretValue } from "../config.ts";

export interface MediaConfig {
  /** Signalling URL for browsers (ws:// or wss://). */
  url: string;
  apiKey: string;
  apiSecret: SecretValue<string>;
  room: string;
}

export class MediaConfigError extends Error {
  override name = "MediaConfigError";
}

/** The path Caddy forwards to livekit-server (deploy/Caddyfile). */
export const LIVEKIT_PROXY_PATH = "/livekit";

/** `https://office.example` → `wss://office.example/livekit`. */
export function defaultLiveKitUrl(publicUrl: string): string {
  const u = new URL(publicUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = LIVEKIT_PROXY_PATH;
  u.search = "";
  u.hash = "";
  return u.toString();
}

function normaliseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new MediaConfigError(`LIVEKIT_URL is not a URL: ${raw}`);
  }
  if (u.protocol === "http:") u.protocol = "ws:";
  else if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol !== "ws:" && u.protocol !== "wss:")
    throw new MediaConfigError(`LIVEKIT_URL must be ws://, wss://, http:// or https:// (${raw})`);
  return u.toString().replace(/\/$/, "");
}

/** Media settings, or null when LiveKit is not configured. */
export function loadMediaConfig(
  env: Record<string, string | undefined>,
  publicUrl: string,
): MediaConfig | null {
  const key = env.LIVEKIT_API_KEY?.trim() ?? "";
  const secret = env.LIVEKIT_API_SECRET?.trim() ?? "";
  if (!key && !secret) return null;
  if (!key || !secret) {
    throw new MediaConfigError(
      "Set both LIVEKIT_API_KEY and LIVEKIT_API_SECRET (scripts/setup.sh --media generates them), or neither to run without voice and screen share.",
    );
  }
  if (/[\s:]/.test(key)) {
    throw new MediaConfigError("LIVEKIT_API_KEY must not contain spaces or colons.");
  }
  const rawUrl = env.LIVEKIT_URL?.trim();
  const url = rawUrl ? normaliseUrl(rawUrl) : defaultLiveKitUrl(publicUrl);
  if (publicUrl.startsWith("https:") && url.startsWith("ws:")) {
    throw new MediaConfigError(
      `LIVEKIT_URL is ${url}, but the office is served over https: browsers block ws:// from an https page. Use wss:// (the default, ${defaultLiveKitUrl(publicUrl)}, goes through Caddy).`,
    );
  }
  return { url, apiKey: key, apiSecret: new SecretValue(secret), room: MEDIA_ROOM };
}

/** Safe to log: no secret, only whether it is set. */
export function describeMediaConfig(config: MediaConfig | null): Record<string, unknown> {
  return config ? { enabled: true, url: config.url, room: config.room } : { enabled: false };
}
